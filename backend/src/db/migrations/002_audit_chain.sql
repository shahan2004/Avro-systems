CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_mutation ON ticket_events;
CREATE TRIGGER events_no_mutation BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS events_no_truncate ON ticket_events;
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON ticket_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS messages_no_mutation ON messages;
CREATE TRIGGER messages_no_mutation BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS messages_no_truncate ON messages;
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON messages
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS notes_no_mutation ON internal_notes;
CREATE TRIGGER notes_no_mutation BEFORE UPDATE OR DELETE ON internal_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS notes_no_truncate ON internal_notes;
CREATE TRIGGER notes_no_truncate BEFORE TRUNCATE ON internal_notes
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION ticket_events_chain() RETURNS trigger AS $$
DECLARE
  last_seq int;
  last_hash text;
BEGIN
  SELECT seq, hash INTO last_seq, last_hash
    FROM ticket_events
   WHERE ticket_id = NEW.ticket_id
   ORDER BY seq DESC
   LIMIT 1;

  NEW.seq := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.occurred_at := COALESCE(
    NULLIF(current_setting('frontdesk.clock_override', true), '')::timestamptz,
    clock_timestamp()
  );

  NEW.hash := encode(digest(
    NEW.prev_hash || '|' ||
    NEW.ticket_id::text || '|' ||
    NEW.seq::text || '|' ||
    NEW.type || '|' ||
    NEW.actor_type || '|' ||
    COALESCE(NEW.actor_id::text, '') || '|' ||
    NEW.payload::text || '|' ||
    to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sha256'
  ), 'hex');

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_chain ON ticket_events;
CREATE TRIGGER events_chain BEFORE INSERT ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION ticket_events_chain();
