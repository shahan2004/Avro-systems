# Frontdesk Architecture Decisions

This document records the architectural and domain decisions made to resolve ambiguities in the Arvo Systems story (Notes from the First Meeting and Problem Reports).

---

## Decisions Log (D1 – D18)

### D1: Working Hours Definition
- **Decision:** A standard working day is exactly 9 hours, running from **09:30 to 18:30 IST** (Monday through Friday).
- **Rationale:** Meera explicitly states: *"We work 9:30 to 6:30, Monday to Friday. Nobody works on weekends. We do not work on festival holidays."* No lunch break was mentioned, so a continuous 540 working-minute window is modelled per day.

### D2: Working Time Metric Units
- **Decision:** All SLA metrics are calculated in **working minutes**, never wall-clock hours:
  - Half day = **270 working minutes** (4.5 hours)
  - 1 working day = **540 working minutes** (9 hours)
  - "About 3 days" = **1620 working minutes** (3 × 540)
  - "About 1 week" = **2700 working minutes** (5 × 540)
- **Rationale:** Eliminates ambiguity and ensures deterministic math across weekends and holidays.

### D3: Urgent Resolution Target
- **Decision:** Urgent ticket resolution due date is **close of business (18:30 IST)** on the working day SLA begins.
- **Rationale:** Meera stated: *"fix it the same working day"*. If a ticket arrives after hours (e.g., Saturday 11:00 or Friday 19:00), SLA starts at Monday 09:30 IST, and resolution is due Monday 18:30 IST.

### D4: SLA Start Anchor
- **Decision:** SLA clock starts at ticket creation timestamp if created inside working hours. If submitted outside working hours (after 18:30, before 09:30, weekends, holidays), SLA starts at **09:30 IST of the next working day**.
- **Rationale:** Complies with: *"If a ticket arrives at 6 PM on Friday, it should not be late on Sunday morning."*

### D5: First Response Definition
- **Decision:** A "First Response" is strictly defined as the **first public agent reply** sent from the ticket composer.
- **Rationale:** Automated receipt acknowledgements or claiming the ticket do not count as communicating a response to the customer.

### D6: Waiting on Customer Pause Mechanics
- **Decision:** Entering `waiting_on_customer` status is only permitted together with sending a public agent message containing the clarifying question. It pauses the **resolution clock**.
- **Rationale:** Response SLA is already met when the agent asks the question. Pausing resolution stops customer delay from counting against Arvo.

### D7: Clock Resumption on Customer Reply
- **Decision:** When the customer replies from the portal while in `waiting_on_customer`, the status reverts to `open`, the original assignee is preserved, and the resolution due date is pushed forward by the exact number of **working minutes** elapsed during the pause.
- **Rationale:** Restores active workflow seamlessly without penalizing agents for customer wait time.

### D8: Auto-Close for Inactive Customers
- **Decision:** If a ticket remains in `waiting_on_customer` for **2700 continuous working minutes** (5 full working days) without customer response, the system auto-closes the ticket with `close_reason = customer_unresponsive`.
- **Rationale:** Direct implementation of Meera's rule: *"If a customer does not reply for about one working week, we close the ticket. They can always contact us again later."*

### D9: Customer Reopen Window
- **Decision:** A resolved ticket may be reopened by the customer within **7 calendar days** of `resolved_at`.
- **Rationale:** Reopening within 7 days increments the ticket `cycle` (cycle + 1), resets SLA clocks with fresh targets, and logs a `reopened` event. Old cycle performance remains permanently in the audit chain.

### D10: Post-Window Handling (Follow-up Tickets)
- **Decision:** After the 7-day reopen window expires, the ticket transitions to `closed` with `close_reason = resolved_window_elapsed`. If the customer needs further help, they are prompted to create a linked **follow-up ticket** (`follow_up_of` foreign key).
- **Rationale:** Matches Meera's rule: *"After that it is a new ticket, not the old one."*

### D11: Mid-flight Priority Changes (Answers Meera's Open Question)
- **Decision:**
  1. The SLA clock is **never reset** on priority change.
  2. Already-satisfied milestones are **never re-evaluated** (e.g. a reply sent in time under medium remains "met" even if later escalated).
  3. Unsatisfied milestones are recomputed from the **original SLA start** using the new priority's budget plus accumulated paused minutes.
  4. If the newly computed target is already in the past, the ticket is flagged overdue immediately, and an `sla_breached` event is recorded with `cause = priority_escalated`.
  5. Downgrading extends unsatisfied targets, but previously recorded breach flags remain **sticky** (never erased).
- **Rationale:** Prevents gaming the system by downgrading tickets to avoid breach reports, while fairly reflecting escalation reality.

### D12: Customer Follow-ups Do Not Restart Response SLA
- **Decision:** Subsequent customer replies during an open cycle do not trigger a new first-response SLA clock.
- **Rationale:** Response SLA measures initial time-to-first-touch; conversational back-and-forth is bounded by the resolution SLA.

### D13: Role Permissions & Concurrency Ownership
- **Decision:** Only the **assignee** can reply, add notes, change priority, or resolve a ticket. Unassigned tickets must be claimed first. The **Support Lead** has administrative override to assign, transfer, or manage any ticket.
- **Rationale:** Directly eliminates the root cause of INC-0291 (multiple agents replying with conflicting answers).

### D14: Customer Severity Selection
- **Decision:** Customers select severity using three plain-language choices:
  - *"I cannot work at all"* -> `urgent`
  - *"I am partly blocked"* -> `medium`
  - *"Question or small request"* -> `low`
- **Rationale:** Eliminates technical jargon for customers while mapping cleanly to domain SLA targets.

### D15: Resolution Safeguard
- **Decision:** A ticket cannot be marked `resolved` unless the current cycle has at least **one public agent reply**.
- **Rationale:** Prevents agents from silently closing tickets without actually communicating a solution to the customer.

### D16: Outbound Email Omission
- **Decision:** Outbound SMTP/email delivery is omitted in the 8-hour scope. All communication is hosted within the customer's secure portal URL.
- **Rationale:** Documented in completion note. Focus is placed on data integrity, concurrency, and audit correctness over third-party mailer configurations.

### D17: Festival Holidays Table
- **Decision:** Holidays are stored in a dedicated database table (`holidays`) editable by the lead via `/admin/holidays`.
- **Rationale:** Allows dynamic configuration of festival days without requiring application redeployment.

### D18: Immutability of Messages and Notes
- **Decision:** Public messages and internal team notes are strictly **append-only**. Database triggers prevent `UPDATE`, `DELETE`, and `TRUNCATE`.
- **Rationale:** Preserves evidentiary integrity for disputes (INC-0318). Corrections must be submitted as a new message.
