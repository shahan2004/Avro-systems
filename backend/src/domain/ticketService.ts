import crypto from 'crypto';
import pg from 'pg';
import { pool, query } from '../db/pool.js';
import {
  Holidays,
  nextWorkingStart,
  workingMinutesBetween,
} from './businessTime.js';
import {
  Priority,
  TicketStatus,
  computeBudgets,
  computeDue,
  computeSlaState,
  SLA,
} from './sla.js';
import { insertAuditEvent } from './audit.js';
import { addInternalNote } from './notesRepo.js';

export interface TicketRow {
  id: number;
  customer_name: string;
  customer_email: string;
  subject: string;
  priority: Priority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name?: string | null;
  portal_token_hash: string;
  follow_up_of: number | null;
  version: number;
  cycle: number;
  created_at: Date;
  cycle_started_at: Date;
  sla_start_at: Date;
  paused_at: Date | null;
  paused_working_minutes: number;
  response_due_at: Date | null;
  resolution_due_at: Date | null;
  first_response_at: Date | null;
  response_breached_at: Date | null;
  resolution_breached_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  reopen_count: number;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public extras: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export async function getHolidays(client: pg.PoolClient | pg.Pool = pool): Promise<Holidays> {
  const res = await client.query<{ day: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') as day FROM holidays`
  );
  return new Set(res.rows.map((r) => r.day));
}

export function generatePortalToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

// Create a new ticket (from Customer Portal or follow-up)
export async function createTicket(
  params: {
    customerName: string;
    customerEmail: string;
    subject: string;
    description: string;
    priority: Priority;
    followUpOf?: number | null;
    createdAtOverride?: Date;
  },
  clientOrPool: pg.PoolClient | pg.Pool = pool
): Promise<{ ticket: TicketRow; portalToken: string }> {
  const client = 'connect' in clientOrPool ? await clientOrPool.connect() : clientOrPool;
  const shouldRelease = 'connect' in clientOrPool;

  try {
    const holidays = await getHolidays(client);
    const now = params.createdAtOverride || new Date();
    const slaStartAt = nextWorkingStart(now, holidays);
    const budgets = computeBudgets(params.priority, slaStartAt, holidays);
    const responseDueAt = computeDue(slaStartAt, budgets.responseBudgetMin, 0, holidays);
    const resolutionDueAt = computeDue(slaStartAt, budgets.resolutionBudgetMin, 0, holidays);

    const { token, hash } = generatePortalToken();

    const insertRes = await client.query<TicketRow>(
      `INSERT INTO tickets (
        customer_name, customer_email, subject, priority, status,
        portal_token_hash, follow_up_of, sla_start_at,
        response_due_at, resolution_due_at, created_at, cycle_started_at
      ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9, $10, $10)
      RETURNING *`,
      [
        params.customerName,
        params.customerEmail,
        params.subject,
        params.priority,
        hash,
        params.followUpOf || null,
        slaStartAt,
        responseDueAt,
        resolutionDueAt,
        now,
      ]
    );

    const ticket = insertRes.rows[0];

    // Insert first customer message (the initial description)
    const msgRes = await client.query<{ id: number }>(
      `INSERT INTO messages (ticket_id, author_type, body, created_at)
       VALUES ($1, 'customer', $2, $3)
       RETURNING id`,
      [ticket.id, params.description, now]
    );

    // Audit event: ticket_created
    await insertAuditEvent(client, {
      ticketId: ticket.id,
      type: 'ticket_created',
      actorType: 'customer',
      payload: {
        priority: ticket.priority,
        message_id: msgRes.rows[0].id,
        follow_up_of: ticket.follow_up_of,
        response_due_at: ticket.response_due_at,
        resolution_due_at: ticket.resolution_due_at,
      },
    });

    return { ticket, portalToken: token };
  } finally {
    if (shouldRelease && 'release' in client) {
      client.release();
    }
  }
}

// INC-0291: Atomic ticket claim
export async function claimTicket(
  ticketId: number,
  agentId: string,
  clientOrPool: pg.PoolClient | pg.Pool = pool
): Promise<TicketRow> {
  // Direct atomic update in SQL
  const res = await clientOrPool.query<TicketRow>(
    `UPDATE tickets
        SET assignee_id = $1, version = version + 1
      WHERE id = $2 AND assignee_id IS NULL AND status IN ('open')
     RETURNING *`,
    [agentId, ticketId]
  );

  if (res.rowCount === 0) {
    // Determine why claim failed: already claimed, or closed/invalid
    const existing = await clientOrPool.query<{
      assignee_id: string | null;
      status: string;
      assignee_name?: string | null;
    }>(
      `SELECT t.assignee_id, t.status, a.name as assignee_name
         FROM tickets t
         LEFT JOIN agents a ON t.assignee_id = a.id
        WHERE t.id = $1`,
      [ticketId]
    );

    if (existing.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket does not exist');
    }

    const row = existing.rows[0];
    if (row.assignee_id) {
      throw new AppError(409, 'ALREADY_CLAIMED', 'Ticket has already been claimed by another agent', {
        assignedTo: row.assignee_name || 'Another agent',
      });
    }

    throw new AppError(409, 'INVALID_TRANSITION', `Cannot claim ticket in ${row.status} status`);
  }

  const updatedTicket = res.rows[0];

  await insertAuditEvent(clientOrPool, {
    ticketId,
    type: 'claimed',
    actorType: 'agent',
    actorId: agentId,
    payload: { version: updatedTicket.version },
  });

  return updatedTicket;
}

// Release ticket back to unassigned queue
export async function releaseTicket(
  ticketId: number,
  agentId: string,
  isLead: boolean
): Promise<TicketRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!isLead && ticket.assignee_id !== agentId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the assignee or lead can release this ticket');
    }

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET assignee_id = NULL, version = version + 1
        WHERE id = $1
       RETURNING *`,
      [ticketId]
    );

    await insertAuditEvent(client, {
      ticketId,
      type: 'released',
      actorType: 'agent',
      actorId: agentId,
      payload: { previous_assignee: ticket.assignee_id },
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Assign ticket to another agent (Lead or transfer by current assignee)
export async function assignTicket(
  ticketId: number,
  newAssigneeId: string,
  actorId: string,
  isLead: boolean
): Promise<TicketRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!isLead && ticket.assignee_id !== actorId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the current assignee or lead can assign this ticket');
    }

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET assignee_id = $1, version = version + 1
        WHERE id = $2
       RETURNING *`,
      [newAssigneeId, ticketId]
    );

    await insertAuditEvent(client, {
      ticketId,
      type: 'assigned',
      actorType: 'agent',
      actorId: actorId,
      payload: { previous_assignee: ticket.assignee_id, new_assignee: newAssigneeId },
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Send public agent reply (with optional wait-on-customer pause)
export async function sendAgentReply(
  ticketId: number,
  agentId: string,
  body: string,
  waitForCustomer = false,
  isLead = false,
  nowOverride?: Date
): Promise<{ ticket: TicketRow; messageId: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!ticket.assignee_id) {
      throw new AppError(409, 'CLAIM_FIRST', 'Ticket must be claimed before replying');
    }
    if (!isLead && ticket.assignee_id !== agentId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the assignee can reply to this ticket');
    }
    if (ticket.status === 'closed') {
      throw new AppError(409, 'TICKET_CLOSED', 'Cannot reply to a closed ticket');
    }

    const now = nowOverride || new Date();
    const holidays = await getHolidays(client);

    // Insert public message
    const msgRes = await client.query<{ id: number }>(
      `INSERT INTO messages (ticket_id, author_type, author_agent_id, body, created_at)
       VALUES ($1, 'agent', $2, $3, $4)
       RETURNING id`,
      [ticketId, agentId, body, now]
    );
    const messageId = msgRes.rows[0].id;

    // Check first response
    let firstResponseAt = ticket.first_response_at;
    let responseBreachedAt = ticket.response_breached_at;

    if (!firstResponseAt) {
      firstResponseAt = now;
      if (ticket.response_due_at && now.getTime() > new Date(ticket.response_due_at).getTime()) {
        responseBreachedAt = ticket.response_due_at;
        await insertAuditEvent(client, {
          ticketId,
          type: 'sla_breached',
          actorType: 'system',
          payload: {
            milestone: 'response',
            due_at: ticket.response_due_at,
            cause: 'no_first_reply',
          },
        });
      }
    }

    let newStatus = ticket.status;
    let pausedAt = ticket.paused_at;
    let resolutionDueAt = ticket.resolution_due_at;

    if (waitForCustomer) {
      newStatus = 'waiting_on_customer';
      pausedAt = now;
      resolutionDueAt = null; // Paused clock
      await insertAuditEvent(client, {
        ticketId,
        type: 'sla_paused',
        actorType: 'agent',
        actorId: agentId,
        payload: {
          paused_at: now,
          resolution_due_before_pause: ticket.resolution_due_at,
        },
      });
    }

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET status = $1,
              first_response_at = $2,
              response_breached_at = $3,
              paused_at = $4,
              resolution_due_at = $5,
              version = version + 1
        WHERE id = $6
       RETURNING *`,
      [newStatus, firstResponseAt, responseBreachedAt, pausedAt, resolutionDueAt, ticketId]
    );

    await insertAuditEvent(client, {
      ticketId,
      type: 'reply_sent',
      actorType: 'agent',
      actorId: agentId,
      payload: { message_id: messageId, waiting_for_customer: waitForCustomer },
    });

    await client.query('COMMIT');
    return { ticket: updateRes.rows[0], messageId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Add internal team note (INC-0304: Isolated table and audit payload)
export async function addNote(
  ticketId: number,
  agentId: string,
  body: string,
  isLead = false
): Promise<{ noteId: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!isLead && ticket.assignee_id !== agentId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the assignee or lead can add notes to this ticket');
    }

    const note = await addInternalNote(client, { ticketId, authorAgentId: agentId, body });

    // Payload NEVER contains note text (INC-0304)
    await insertAuditEvent(client, {
      ticketId,
      type: 'note_added',
      actorType: 'agent',
      actorId: agentId,
      payload: { note_id: note.id },
    });

    await client.query('COMMIT');
    return { noteId: note.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Change ticket priority (D11: Clock never restarted, unsatisfied recalculated from start)
export async function changePriority(
  ticketId: number,
  agentId: string,
  newPriority: Priority,
  reason?: string,
  isLead = false,
  nowOverride?: Date
): Promise<TicketRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!isLead && ticket.assignee_id !== agentId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the assignee or lead can change priority');
    }

    if (ticket.priority === newPriority) {
      await client.query('COMMIT');
      return ticket;
    }

    const now = nowOverride || new Date();
    const holidays = await getHolidays(client);
    const oldPriority = ticket.priority;

    const newBudgets = computeBudgets(newPriority, new Date(ticket.sla_start_at), holidays);

    let newResponseDueAt = ticket.response_due_at;
    let newResponseBreachedAt = ticket.response_breached_at;

    // Response milestone: if NOT yet met, recalculate
    if (!ticket.first_response_at) {
      newResponseDueAt = computeDue(new Date(ticket.sla_start_at), newBudgets.responseBudgetMin, 0, holidays);
      if (now.getTime() > newResponseDueAt.getTime()) {
        newResponseBreachedAt = newResponseBreachedAt || newResponseDueAt;
        await insertAuditEvent(client, {
          ticketId,
          type: 'sla_breached',
          actorType: 'system',
          payload: {
            milestone: 'response',
            due_at: newResponseDueAt,
            cause: 'priority_escalated',
          },
        });
      }
    }

    // Resolution milestone: if NOT resolved / closed, recalculate
    let newResolutionDueAt = ticket.resolution_due_at;
    let newResolutionBreachedAt = ticket.resolution_breached_at;

    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      if (ticket.status === 'waiting_on_customer') {
        newResolutionDueAt = null; // Stays paused
      } else {
        newResolutionDueAt = computeDue(
          new Date(ticket.sla_start_at),
          newBudgets.resolutionBudgetMin,
          ticket.paused_working_minutes,
          holidays
        );
        if (now.getTime() > newResolutionDueAt.getTime()) {
          newResolutionBreachedAt = newResolutionBreachedAt || newResolutionDueAt;
          await insertAuditEvent(client, {
            ticketId,
            type: 'sla_breached',
            actorType: 'system',
            payload: {
              milestone: 'resolution',
              due_at: newResolutionDueAt,
              cause: 'priority_escalated',
            },
          });
        }
      }
    }

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET priority = $1,
              response_due_at = $2,
              response_breached_at = $3,
              resolution_due_at = $4,
              resolution_breached_at = $5,
              version = version + 1
        WHERE id = $6
       RETURNING *`,
      [newPriority, newResponseDueAt, newResponseBreachedAt, newResolutionDueAt, newResolutionBreachedAt, ticketId]
    );

    await insertAuditEvent(client, {
      ticketId,
      type: 'priority_changed',
      actorType: 'agent',
      actorId: agentId,
      payload: {
        from: oldPriority,
        to: newPriority,
        reason: reason || null,
        response_due_at: newResponseDueAt,
        resolution_due_at: newResolutionDueAt,
      },
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Mark ticket as resolved (D15: requires ≥ 1 public agent reply in cycle)
export async function resolveTicket(
  ticketId: number,
  agentId: string,
  isLead = false,
  nowOverride?: Date
): Promise<TicketRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];

    if (!isLead && ticket.assignee_id !== agentId) {
      throw new AppError(403, 'NOT_ASSIGNEE', 'Only the assignee or lead can resolve this ticket');
    }
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      throw new AppError(409, 'INVALID_TRANSITION', `Ticket is already ${ticket.status}`);
    }

    // Check that there is at least one public agent reply in the current cycle
    const replyCountRes = await client.query<{ count: string }>(
      `SELECT count(*) as count
         FROM messages
        WHERE ticket_id = $1
          AND author_type = 'agent'
          AND created_at >= $2`,
      [ticketId, ticket.cycle_started_at]
    );

    if (parseInt(replyCountRes.rows[0].count, 10) === 0) {
      throw new AppError(
        400,
        'AGENT_REPLY_REQUIRED',
        'Cannot resolve a ticket without at least one public agent reply in this cycle (D15)'
      );
    }

    const now = nowOverride || new Date();
    let resolutionBreachedAt = ticket.resolution_breached_at;

    if (ticket.resolution_due_at && now.getTime() > new Date(ticket.resolution_due_at).getTime()) {
      resolutionBreachedAt = resolutionBreachedAt || ticket.resolution_due_at;
      await insertAuditEvent(client, {
        ticketId,
        type: 'sla_breached',
        actorType: 'system',
        payload: {
          milestone: 'resolution',
          due_at: ticket.resolution_due_at,
          cause: 'slow_resolution',
        },
      });
    }

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET status = 'resolved',
              resolved_at = $1,
              resolution_breached_at = $2,
              paused_at = NULL,
              version = version + 1
        WHERE id = $3
       RETURNING *`,
      [now, resolutionBreachedAt, ticketId]
    );

    await insertAuditEvent(client, {
      ticketId,
      type: 'resolved',
      actorType: 'agent',
      actorId: agentId,
      payload: { resolved_at: now },
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Customer reply from portal (resumes paused clock or reopens resolved ticket)
export async function customerReply(
  portalToken: string,
  body: string,
  nowOverride?: Date
): Promise<{ ticket: TicketRow; messageId: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenHash = crypto.createHash('sha256').update(portalToken).digest('hex');

    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE portal_token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );

    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found or invalid link');
    }
    const ticket = ticketRes.rows[0];
    const now = nowOverride || new Date();
    const holidays = await getHolidays(client);

    // If closed: cannot reply directly, can create follow-up
    if (ticket.status === 'closed') {
      throw new AppError(
        409,
        'TICKET_CLOSED',
        'Ticket is permanently closed. You may create a follow-up ticket.',
        { canCreateFollowUp: true }
      );
    }

    // If resolved: check reopen window (7 days)
    if (ticket.status === 'resolved') {
      const reopenLimit = new Date(new Date(ticket.resolved_at!).getTime() + SLA.reopenWindowDays * 24 * 60 * 60 * 1000);
      if (now.getTime() > reopenLimit.getTime()) {
        // Expired -> auto-close and inform
        await client.query(
          `UPDATE tickets
              SET status = 'closed', closed_at = $1, close_reason = 'resolved_window_elapsed', version = version + 1
            WHERE id = $2`,
          [now, ticket.id]
        );
        await insertAuditEvent(client, {
          ticketId: ticket.id,
          type: 'closed',
          actorType: 'system',
          payload: { reason: 'resolved_window_elapsed' },
        });
        await client.query('COMMIT');

        throw new AppError(
          409,
          'REOPEN_WINDOW_EXPIRED',
          'The 7-day reopen window has expired. You may create a follow-up ticket.',
          { canCreateFollowUp: true }
        );
      }

      // Reopen within window
      const newSlaStartAt = nextWorkingStart(now, holidays);
      const budgets = computeBudgets(ticket.priority, newSlaStartAt, holidays);
      const responseDueAt = computeDue(newSlaStartAt, budgets.responseBudgetMin, 0, holidays);
      const resolutionDueAt = computeDue(newSlaStartAt, budgets.resolutionBudgetMin, 0, holidays);

      const msgRes = await client.query<{ id: number }>(
        `INSERT INTO messages (ticket_id, author_type, body, created_at)
         VALUES ($1, 'customer', $2, $3)
         RETURNING id`,
        [ticket.id, body, now]
      );
      const messageId = msgRes.rows[0].id;

      const updateRes = await client.query<TicketRow>(
        `UPDATE tickets
            SET status = 'open',
                cycle = cycle + 1,
                reopen_count = reopen_count + 1,
                cycle_started_at = $1,
                sla_start_at = $2,
                response_due_at = $3,
                resolution_due_at = $4,
                first_response_at = NULL,
                response_breached_at = NULL,
                resolution_breached_at = NULL,
                resolved_at = NULL,
                paused_at = NULL,
                paused_working_minutes = 0,
                version = version + 1
          WHERE id = $5
         RETURNING *`,
        [now, newSlaStartAt, responseDueAt, resolutionDueAt, ticket.id]
      );

      await insertAuditEvent(client, {
        ticketId: ticket.id,
        type: 'customer_replied',
        actorType: 'customer',
        payload: { message_id: messageId },
      });

      await insertAuditEvent(client, {
        ticketId: ticket.id,
        type: 'reopened',
        actorType: 'customer',
        payload: { cycle: ticket.cycle + 1, reopen_count: ticket.reopen_count + 1 },
      });

      await client.query('COMMIT');
      return { ticket: updateRes.rows[0], messageId };
    }

    // If waiting on customer: resume clock
    let pausedWorkingMin = ticket.paused_working_minutes;
    let newResolutionDueAt = ticket.resolution_due_at;

    if (ticket.status === 'waiting_on_customer') {
      const pauseStart = ticket.paused_at ? new Date(ticket.paused_at) : now;
      const pausedDelta = workingMinutesBetween(pauseStart, now, holidays);
      pausedWorkingMin += Math.round(pausedDelta);

      const budgets = computeBudgets(ticket.priority, new Date(ticket.sla_start_at), holidays);
      newResolutionDueAt = computeDue(
        new Date(ticket.sla_start_at),
        budgets.resolutionBudgetMin,
        pausedWorkingMin,
        holidays
      );

      await insertAuditEvent(client, {
        ticketId: ticket.id,
        type: 'sla_resumed',
        actorType: 'customer',
        payload: {
          paused_minutes: Math.round(pausedDelta),
          new_resolution_due_at: newResolutionDueAt,
        },
      });
    }

    const msgRes = await client.query<{ id: number }>(
      `INSERT INTO messages (ticket_id, author_type, body, created_at)
       VALUES ($1, 'customer', $2, $3)
       RETURNING id`,
      [ticket.id, body, now]
    );
    const messageId = msgRes.rows[0].id;

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET status = 'open',
              paused_at = NULL,
              paused_working_minutes = $1,
              resolution_due_at = $2,
              version = version + 1
        WHERE id = $3
       RETURNING *`,
      [pausedWorkingMin, newResolutionDueAt, ticket.id]
    );

    await insertAuditEvent(client, {
      ticketId: ticket.id,
      type: 'customer_replied',
      actorType: 'customer',
      payload: { message_id: messageId },
    });

    await client.query('COMMIT');
    return { ticket: updateRes.rows[0], messageId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Customer explicit reopen button
export async function customerReopen(
  portalToken: string,
  reason?: string,
  nowOverride?: Date
): Promise<TicketRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenHash = crypto.createHash('sha256').update(portalToken).digest('hex');

    const ticketRes = await client.query<TicketRow>(
      `SELECT * FROM tickets WHERE portal_token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );

    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found or invalid link');
    }
    const ticket = ticketRes.rows[0];

    if (ticket.status === 'closed') {
      throw new AppError(
        409,
        'REOPEN_WINDOW_EXPIRED',
        'The reopen window has expired and this ticket is closed. You may create a follow-up ticket.',
        { canCreateFollowUp: true }
      );
    }

    if (ticket.status !== 'resolved') {
      throw new AppError(409, 'INVALID_TRANSITION', `Cannot reopen ticket in status ${ticket.status}`);
    }

    const now = nowOverride || new Date();
    const reopenLimit = new Date(new Date(ticket.resolved_at!).getTime() + SLA.reopenWindowDays * 24 * 60 * 60 * 1000);

    if (now.getTime() > reopenLimit.getTime()) {
      await client.query(
        `UPDATE tickets
            SET status = 'closed', closed_at = $1, close_reason = 'resolved_window_elapsed', version = version + 1
          WHERE id = $2`,
        [now, ticket.id]
      );
      await insertAuditEvent(client, {
        ticketId: ticket.id,
        type: 'closed',
        actorType: 'system',
        payload: { reason: 'resolved_window_elapsed' },
      });
      await client.query('COMMIT');

      throw new AppError(
        409,
        'REOPEN_WINDOW_EXPIRED',
        'The 7-day reopen window has expired. You may create a follow-up ticket.',
        { canCreateFollowUp: true }
      );
    }

    const holidays = await getHolidays(client);
    const newSlaStartAt = nextWorkingStart(now, holidays);
    const budgets = computeBudgets(ticket.priority, newSlaStartAt, holidays);
    const responseDueAt = computeDue(newSlaStartAt, budgets.responseBudgetMin, 0, holidays);
    const resolutionDueAt = computeDue(newSlaStartAt, budgets.resolutionBudgetMin, 0, holidays);

    const updateRes = await client.query<TicketRow>(
      `UPDATE tickets
          SET status = 'open',
              cycle = cycle + 1,
              reopen_count = reopen_count + 1,
              cycle_started_at = $1,
              sla_start_at = $2,
              response_due_at = $3,
              resolution_due_at = $4,
              first_response_at = NULL,
              response_breached_at = NULL,
              resolution_breached_at = NULL,
              resolved_at = NULL,
              paused_at = NULL,
              paused_working_minutes = 0,
              version = version + 1
        WHERE id = $5
       RETURNING *`,
      [now, newSlaStartAt, responseDueAt, resolutionDueAt, ticket.id]
    );

    await insertAuditEvent(client, {
      ticketId: ticket.id,
      type: 'reopened',
      actorType: 'customer',
      payload: {
        cycle: ticket.cycle + 1,
        reopen_count: ticket.reopen_count + 1,
        reason: reason || null,
      },
    });

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
