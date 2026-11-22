# Frontdesk — Support Ticket & SLA System for Arvo Systems

> Built for the iNav Technologies Full Stack Developer Hiring Test (Arvo Systems).  
> Designed to replace spreadsheets and WhatsApp groups with rock-solid business-time SLA tracking, atomic concurrency safety, leak-proof internal notes, and cryptographic audit logging.

---

## 1. Quick Overview

- **Repository Link:** [https://github.com/shahan2004/Avro-systems](https://github.com/shahan2004/Avro-systems)
- **Live URL:** [https://frontdesk-app-si2p.onrender.com](https://frontdesk-app-si2p.onrender.com) *(Render live deployment)*
- **Customer Portal:** `/portal/new`
- **Agent / Lead Login:** `/login`

### Demo Credentials (Pre-seeded)
All demo accounts use password: `Frontdesk@123`

| Name | Role | Email | Purpose |
|---|---|---|---|
| **Meera Nair** | Support Lead | `meera@arvo.test` | Full admin, SLA Reports, Holiday management, Audit verify |
| **Rahul Sharma** | Support Agent | `agent1@arvo.test` | Agent ticket triage, claiming, public replies, internal notes |
| **Priya Patel** | Support Agent | `agent2@arvo.test` | Agent ticket triage |
| *(Agents 3–9)* | Support Agents | `agent3@arvo.test` … `agent9@arvo.test` | Team members for assignment and load balancing |

---

## 2. Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| **Backend** | Node.js 20+ + TypeScript + Express | High throughput, strict type safety, predictable execution |
| **Database** | PostgreSQL 15+ (`pgcrypto`) | Row-level locking (`SELECT ... FOR UPDATE`), atomic `RETURNING`, cryptographically secure digests |
| **Frontend** | React 18 + TypeScript + Vite + React Router | Single deploy served as static SPA bundle directly by Express |
| **Auth** | JWT in `httpOnly` `SameSite=Lax` cookie + `bcryptjs` | Resilient, XSS-safe session management |
| **Testing** | Vitest + Supertest | 25 automated tests run against real PostgreSQL database |
| **Timezone** | `Asia/Kolkata` (IST, UTC+05:30) | Fixed 330 min offset, zero daylight saving shifts, server as single source of truth |

---

## 3. How the 3 Incidents Are Solved

### 3.1 INC-0291: Concurrent "Take This Ticket" Race Condition
* **Problem:** Two agents clicked "Take this ticket" simultaneously. Both replied within a minute with conflicting advice.
* **Root Cause:** Read-then-write race condition allowed both agents to claim the same ticket.
* **Solution (`backend/src/domain/ticketService.ts`):**
  - Claiming is executed via a single **atomic SQL statement**:
    ```sql
    UPDATE tickets
       SET assignee_id = $1, version = version + 1
     WHERE id = $2 AND assignee_id IS NULL AND status IN ('open')
    RETURNING *;
    ```
  - If 0 rows are returned, the transaction queries who holds the ticket and throws `409 ALREADY_CLAIMED` returning `{ assignedTo: "<agent name>" }`.
  - All mutating transitions lock the row using `SELECT ... FROM tickets WHERE id = $1 FOR UPDATE`.
  - Replies, notes, priority modifications, and resolutions by non-assignees return `403 NOT_ASSIGNEE`.
  - Replies on unassigned tickets return `409 CLAIM_FIRST`.
  - **Verification:** `backend/tests/claimRace.test.ts` fires 20 parallel claims from distinct agents simultaneously. Exactly 1 receives HTTP 200, 19 receive HTTP 409, and exactly 1 `claimed` audit event is written.

### 3.2 INC-0304: Private Team Note Leaked to Customer
* **Problem:** An agent wrote an internal note on handling a difficult customer. The note was leaked to the customer.
* **Solution (Multi-layer Defence in Depth):**
  1. **Isolated Storage (`001_init.sql`):** Internal notes live in a completely separate table `internal_notes`. There is no `is_internal` boolean column on `messages`.
  2. **Dedicated Endpoints & UI:** Agent replies use `/api/tickets/:id/replies`; notes use `/api/tickets/:id/notes`. The UI composer features two physically separate tabs: the note composer is yellow, features a lock icon, and shows a persistent warning: *"TEAM ONLY — Customer cannot see this note"*.
  3. **Strict Whitelist Serialization (`backend/src/http/dto.ts`):** Customer portal endpoints use `toPortalTicketDto`, which only maps explicit fields from `messages`.
  4. **Lint Boundary Enforcement (`.eslintrc.cjs`):** ESLint `no-restricted-imports` forbids `notesRepo` from being imported anywhere under `portal.ts` or `dto.ts`.
  5. **Audit Sanitization (`backend/src/domain/audit.ts`):** Audit event payloads store only `{ note_id }` or `{ message_id }`, never raw message text.
  6. **Customer Transcript Cleanliness (`portal.ts`):** Customer `transcript.txt` downloads are compiled solely from `messages`.
  7. **Verification:** `backend/tests/noteLeak.test.ts` inserts a canary secret (`CANARY-SECRET-9f3a`) into an internal note, then hits every customer portal endpoint, transcript generator, CSV export, preview query, and error response, verifying the string appears nowhere.

### 3.3 INC-0318: Dispute Over SLA Timestamps & Response Times
* **Problem:** A customer claimed Arvo did not reply until the next morning. Arvo believed they replied in 40 minutes. Nobody could prove who was right.
* **Solution (`002_audit_chain.sql` & `backend/src/domain/audit.ts`):**
  - Table `ticket_events` is **append-only** and **cryptographically hash-chained** using SHA-256:
    $$\text{hash} = \text{SHA256}(\text{prev\_hash} \parallel \text{ticket\_id} \parallel \text{seq} \parallel \text{type} \parallel \text{actor\_type} \parallel \text{actor\_id} \parallel \text{payload} \parallel \text{occurred\_at})$$
  - PostgreSQL database triggers prevent `UPDATE`, `DELETE`, and `TRUNCATE` on `ticket_events`, `messages`, and `internal_notes`.
  - Timestamps are stamped directly by PostgreSQL `clock_timestamp()`.
  - The ticket timeline displays the exact IST timestamp to the second, actor name, action, and **working minutes elapsed since cycle start**.
  - `GET /api/audit/verify` allows the Support Lead to cryptographically re-verify every link in the hash chain on demand.
  - **Verification:** `backend/tests/auditImmutability.test.ts` asserts that mutation statements fail at the database engine level, and validates tamper detection.

---

## 4. Business-Time Engine & SLA Calculation

The business-time engine is located in `backend/src/domain/businessTime.ts` and `backend/src/domain/sla.ts`. It models pure calendar math in `Asia/Kolkata` (IST):

- **Working Hours:** Monday – Friday, 09:30 to 18:30 IST (9 hours = 540 working minutes/day).
- **Weekends:** Saturdays & Sundays are completely skipped.
- **Festival Holidays:** Dates in the `holidays` database table are skipped.
- **SLA Start Anchor:** If a ticket is created after hours, SLA starts at 09:30 IST on the next working day.
- **Targets:**
  - `urgent`: 120 working minutes first reply, resolution by **end of the same working day** (18:30 IST).
  - `medium`: 270 working minutes first reply (half day), resolution within 1620 working minutes (3 working days).
  - `low`: 540 working minutes first reply (1 working day), resolution within 2700 working minutes (5 working days).
- **Clock Pausing:** Setting a ticket to `waiting_on_customer` pauses the resolution SLA. When the customer replies, the clock resumes, and the due date is pushed forward by the exact working minutes spent waiting.
- **Mid-flight Priority Change (Decision D11):** The clock is never restarted. Satisfied milestones remain met. Unsatisfied milestones get a newly calculated target based on original start time + paused minutes. If already past due, an immediate breach is recorded. Downgrading extends targets, but past breach records remain permanently sticky.

---

## 5. Architectural Design

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                     Express Application                 │
                     │                                                         │
   Customer ─────────┼──▶ /api/portal/* ──────────────┐                        │
 (No auth, token)    │    (Strict DTO Whitelist)      │                        │
                     │                                ▼                        │
    Support Agent ───┼──▶ /api/tickets/* ─────▶ TicketService ──▶ PostgreSQL   │
 (JWT Cookie Auth)   │    /api/reports/*               │          - tickets    │
                     │    /api/admin/*                 ├────────▶ - messages   │
                     │                                 │          - notes      │
                     │                                 ▼          - events     │
                     │                          AuditHashChain    - holidays   │
                     │                                                         │
                     │    Static SPA: React + Vite (Served from /)             │
                     └─────────────────────────────────────────────────────────┘
```

---

## 6. Local Setup & Testing

### Prerequisites
- Node.js 20+ and npm 10+
- PostgreSQL 15+ with `pgcrypto` extension

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd "Arvo System"
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if your PostgreSQL username/password/port differs from `postgresql://postgres@127.0.0.1:5433/frontdesk`.

3. **Install Dependencies:**
   ```bash
   npm install
   ```

4. **Run Database Migrations & Seed:**
   ```bash
   npm run migrate
   npm run seed
   ```

5. **Run Automated Test Suite:**
   ```bash
   npm test
   ```
   *(Runs all 25 unit, concurrency, canary, and lifecycle tests)*

6. **Start Full-Stack Development Server:**
   ```bash
   npm run build
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 7. API Reference Summary

### Agent & Lead Endpoints (JWT Cookie Authenticated)

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticates agent/lead and sets `fd_token` cookie |
| `POST` | `/api/auth/logout` | Agent | Clears auth cookie |
| `GET` | `/api/auth/me` | Agent | Returns current authenticated user profile |
| `GET` | `/api/tickets?view=mine\|unassigned\|all&q=` | Agent/Lead | Returns filtered ticket list with computed SLA status |
| `GET` | `/api/tickets/export.csv` | Lead | Exports CSV of all tickets (strictly excludes notes) |
| `GET` | `/api/tickets/:id` | Agent | Returns ticket detail, conversation, notes, and SLA status |
| `POST` | `/api/tickets/:id/claim` | Agent | Concurrency-safe atomic ticket claim |
| `POST` | `/api/tickets/:id/release` | Assignee/Lead | Releases ticket back to unassigned queue |
| `POST` | `/api/tickets/:id/assign` | Assignee/Lead | Assigns ticket to target agent |
| `POST` | `/api/tickets/:id/replies` | Assignee/Lead | Sends public reply to customer (optional `waitForCustomer`) |
| `POST` | `/api/tickets/:id/notes` | Assignee/Lead | Adds internal note to isolated notes table |
| `POST` | `/api/tickets/:id/priority` | Assignee/Lead | Changes priority with D11 SLA recalculation |
| `POST` | `/api/tickets/:id/resolve` | Assignee/Lead | Resolves ticket (requires ≥1 public agent reply) |
| `GET` | `/api/tickets/:id/events` | Agent | Returns cryptographic audit trail with IST timestamps |
| `GET` | `/api/admin/agents` | Agent | Returns active agents for dropdowns |
| `GET` | `/api/admin/holidays` | Agent | Returns configured festival holidays |
| `POST` | `/api/admin/holidays` | Lead | Adds festival holiday |
| `DELETE` | `/api/admin/holidays/:day` | Lead | Deletes festival holiday |
| `GET` | `/api/reports/sla` | Lead | Manager SLA report: % late, breakdowns, root causes |
| `GET` | `/api/audit/verify` | Lead | Re-computes cryptographic SHA-256 chain for all tickets |
| `GET` | `/healthz` | Public | System health check (200 OK, no DB writes) |

### Customer Portal Endpoints (Unguessable URL Token)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/portal/tickets` | Creates a new ticket with plain-language severity |
| `GET` | `/api/portal/tickets/:token` | Whitelist view of ticket status and public messages |
| `POST` | `/api/portal/tickets/:token/replies` | Customer reply (resumes paused SLA clock) |
| `POST` | `/api/portal/tickets/:token/reopen` | Reopens ticket within 7-day window |
| `GET` | `/api/portal/tickets/:token/transcript.txt` | Downloads plain text transcript (messages only) |
| `POST` | `/api/portal/tickets/:token/follow-up` | Creates linked follow-up ticket for closed tickets |

---

## 8. Known Limitations

1. **Free-Tier Cold Starts:** On free hosting platforms like Render, the container spins down after 15 minutes of inactivity. First load can take ~40 seconds.
2. **Database Superuser Scope:** Immutability triggers and hash chains guarantee tamper resistance against application bugs, SQL injection, and normal database users. A PostgreSQL superuser with raw root server access could theoretically bypass triggers. Mitigation: export head hashes to external git commits or ledger.
3. **Outbound Email:** In accordance with the 8-hour specification, outbound SMTP is omitted; customer interactions occur seamlessly via their private portal link.
