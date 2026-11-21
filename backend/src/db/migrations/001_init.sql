CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('agent','lead')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  day  date PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id                       bigserial PRIMARY KEY,
  customer_name            text NOT NULL,
  customer_email           text NOT NULL,
  subject                  text NOT NULL,
  priority                 text NOT NULL CHECK (priority IN ('urgent','medium','low')),
  status                   text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','waiting_on_customer','resolved','closed')),
  assignee_id              uuid REFERENCES agents(id),
  portal_token_hash        text NOT NULL UNIQUE,
  follow_up_of             bigint REFERENCES tickets(id),
  version                  int  NOT NULL DEFAULT 1,
  cycle                    int  NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  cycle_started_at         timestamptz NOT NULL DEFAULT now(),
  sla_start_at             timestamptz NOT NULL,
  paused_at                timestamptz,
  paused_working_minutes   int  NOT NULL DEFAULT 0,
  response_due_at          timestamptz,
  resolution_due_at        timestamptz,
  first_response_at        timestamptz,
  response_breached_at     timestamptz,
  resolution_breached_at   timestamptz,
  resolved_at              timestamptz,
  closed_at                timestamptz,
  close_reason             text CHECK (close_reason IN ('customer_unresponsive','resolved_window_elapsed')),
  reopen_count             int  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS tickets_assignee_idx ON tickets(assignee_id, status);
CREATE INDEX IF NOT EXISTS tickets_due_idx      ON tickets(resolution_due_at) WHERE status IN ('open','waiting_on_customer');

-- PUBLIC conversation only (customer can see everything in this table)
CREATE TABLE IF NOT EXISTS messages (
  id              bigserial PRIMARY KEY,
  ticket_id       bigint NOT NULL REFERENCES tickets(id),
  author_type     text   NOT NULL CHECK (author_type IN ('customer','agent')),
  author_agent_id uuid   REFERENCES agents(id),
  body            text   NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS messages_ticket_idx ON messages(ticket_id, id);

-- TEAM-ONLY. Never imported by customer-facing code.
CREATE TABLE IF NOT EXISTS internal_notes (
  id              bigserial PRIMARY KEY,
  ticket_id       bigint NOT NULL REFERENCES tickets(id),
  author_agent_id uuid   NOT NULL REFERENCES agents(id),
  body            text   NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS notes_ticket_idx ON internal_notes(ticket_id, id);

CREATE TABLE IF NOT EXISTS ticket_events (
  id          bigserial PRIMARY KEY,
  ticket_id   bigint NOT NULL REFERENCES tickets(id),
  seq         int    NOT NULL,
  type        text   NOT NULL,
  actor_type  text   NOT NULL CHECK (actor_type IN ('agent','customer','system')),
  actor_id    uuid,
  payload     jsonb  NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  prev_hash   text   NOT NULL,
  hash        text   NOT NULL,
  UNIQUE (ticket_id, seq)
);
CREATE INDEX IF NOT EXISTS events_ticket_idx ON ticket_events(ticket_id, seq);
