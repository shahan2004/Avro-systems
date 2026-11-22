# Completion Note — Frontdesk (Arvo Systems)

- **Repository:** https://github.com/shahan2004/Avro-systems
- **Live URL:** https://frontdesk-app-si2p.onrender.com
- **Specification:** iNav Technologies Full Stack Developer Hiring Test

## 1. Done (Verified by Tests & Live Smoke Test)

- [x] **Business-Time Engine (`backend/src/domain/businessTime.ts`)**:
  - Exact IST math (UTC+05:30 offset, 09:30–18:30 IST working window, 540 working minutes/day).
  - Skips weekends (Saturday & Sunday) and dynamic festival holidays (`holidays` table).
  - Friday 18:00 ticket + 270m lands on Monday 13:30; not late on Sunday (verified by Unit Test 1).
  - Sat/Sun creation starts Monday 09:30; 540m budget ends Monday 18:30 exact boundary (verified by Unit Test 2 & 7).
- [x] **SLA Engine & State Calculations (`backend/src/domain/sla.ts`)**:
  - Response & resolution budgets for `urgent`, `medium`, and `low`.
  - Pause resolution clock when in `waiting_on_customer`; resume pushes due date by elapsed working minutes (verified by Unit Test 8 & Lifecycle Test 11).
  - Answers Meera's open question: mid-flight priority changes recalculate unsatisfied milestones from start; satisfied milestones are never re-judged; overdue tickets flagged immediately; downgrades keep past breach flags sticky (verified by Unit Test 9 & 10).
- [x] **Incident Fixes (All 3 Solved and Proven by Automated Tests)**:
  - **INC-0291 (Atomic Claim Race)**: Implemented atomic SQL update `UPDATE ... WHERE id=$id AND assignee_id IS NULL AND status IN ('open') RETURNING *`. Tested with 20 parallel concurrent agent claims (`claimRace.test.ts`) yielding exactly 1 winner, 19 HTTP 409 responses, and exactly 1 audit event.
  - **INC-0304 (Private Note Leak Protection)**: Dedicated `internal_notes` table (never an `is_internal` flag), separate endpoints, whitelist DTO serializer in `dto.ts`, ESLint rule forbidding notes repo imports in portal code, and visual yellow lock banner. Verified by Canary Test (`noteLeak.test.ts`) across all portal endpoints, transcripts, CSV exports, error payloads, and previews with string `CANARY-SECRET-9f3a`.
  - **INC-0318 (Tamper-Proof Audit Trail & Dispute Resolution)**: Cryptographic SHA-256 hash-chaining trigger on append-only `ticket_events` table; database triggers blocking `UPDATE`, `DELETE`, and `TRUNCATE` on events, messages, and notes. Verified by `auditImmutability.test.ts` and lead verification endpoint `GET /api/audit/verify`.
- [x] **Full-Stack Application & Agent Screens**:
  - Single consolidated agent screen (`MyTickets.tsx`) with required grouping: 🔴 Late (overdue first), Active (soonest first), ⏸ Waiting on Customer (paused), Resolved (reopenable).
  - Ticket detail screen with distinct message bubbles, yellow TEAM ONLY note composer, and live cryptographic history timeline with exact IST seconds and working minutes.
  - Customer Portal with plain-language severity selection, ticket status, message thread, 7-day reopen button, follow-up ticket link, and transcript download.
  - Lead SLA Performance & Late Ticket Report (`/reports`) displaying total tickets, on-time percentage, priority & agent breakdowns, root-cause badges, and 1-click audit verification.
  - Lead Holiday Admin (`/admin/holidays`) for CRUD on festival calendar.
  - CSV export for lead (`/api/tickets/export.csv`) strictly excluding private notes.
- [x] **Test Suite**:
  - 25 out of 25 tests passing in Vitest against real PostgreSQL (`DATABASE_URL_TEST`).
  - Zero lint errors with strict TypeScript checks.

---

## 2. Partially Done

- **Real-time Push Notifications**: The agent ticket view uses auto-polling (every 30 seconds and on window focus) rather than WebSockets or Server-Sent Events (SSE). This was a deliberate choice to ensure robustness on free serverless/Render hosts that spin down or drop persistent socket connections.
- **Visual Charts in Reports**: The SLA reporting dashboard renders summary KPI stat cards, percentage gauges, and responsive data tables rather than third-party canvas chart libraries, keeping bundle size minimal and dependencies lean.

---

## 3. Not Done, and Why

- **Outbound Email Delivery (SMTP/SendGrid)**:
  - *Why skipped:* Outbound email configuration requires external domain verification and third-party SMTP credentials, which was out of scope for the ~8-hour budget. Customer replies and ticket access are fully supported via the customer's secure portal URL, and agent replies appear immediately on the portal page.
- **Complex Rich-Text WYSIWYG Editor**:
  - *Why skipped:* Support tickets and private notes use clean, structured Markdown / plain text. This prevents security vulnerabilities (XSS, script injection) and avoids bloated frontend dependencies.
- **Multi-tenant Organization Isolation**:
  - *Why skipped:* The specification describes a single company (Arvo Systems) with 9 agents and 1 lead handling 40 tickets/day. A multi-tenant account architecture was unnecessary and would add unnecessary overhead.

---

## 4. Decisions Made Where the Brief Was Silent

See `docs/DECISIONS.md` for full details. Highlights:
1. **Decision D11 (Priority Change Timer Behavior)**: Clock is never restarted. Satisfied milestones are never re-judged. Unsatisfied milestones are recomputed from the original SLA start using the new priority budget + paused minutes. If past due, immediate breach is logged with `cause = priority_escalated`.
2. **Decision D9 & D10 (Reopen Window & Follow-ups)**: Reopen window is exactly 7 calendar days from `resolved_at`. After 7 days, ticket is permanently closed (`resolved_window_elapsed`), and the customer is prompted to create a linked follow-up ticket (`follow_up_of`).
3. **Decision D8 (Auto-Close Waiting Timeout)**: Customers silent for 2700 continuous working minutes (5 working days) in `waiting_on_customer` are auto-closed with `close_reason = customer_unresponsive`.
4. **Decision D15 (Resolution Safeguard)**: Cannot mark a ticket resolved unless at least 1 public agent reply has been sent in that cycle.

---

## 5. Known Risks & Honest Limits

1. **Free-Tier Cold Starts**: When deployed on free-tier platforms like Render, the web service sleeps after 15 minutes of inactivity. The initial request can take 30–50 seconds to wake up. Mitigation: pinging `/healthz` via an external cron pinger (e.g., cron-job.org).
2. **PostgreSQL Superuser Audit Rewrites**: The cryptographic hash chain and append-only triggers prevent non-superuser application mutations, SQL injections, or accidental edits. However, an infrastructure superuser with direct root access to PostgreSQL could disable triggers and rewrite the chain. Mitigation: periodic cryptographic head hash exports to external cold storage or Git commits.
3. **Festival Holiday Calendar**: The seeded festival holidays (`2026-12-25`, `2027-01-26`) are illustrative. Arvo's support lead should configure specific regional holidays via `/admin/holidays`.
