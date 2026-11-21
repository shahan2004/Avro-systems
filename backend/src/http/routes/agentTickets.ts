import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../db/pool.js';
import {
  claimTicket,
  releaseTicket,
  assignTicket,
  sendAgentReply,
  addNote,
  changePriority,
  resolveTicket,
  getHolidays,
  TicketRow,
  AppError,
} from '../../domain/ticketService.js';
import { computeSlaState, Priority, SLA } from '../../domain/sla.js';
import { runSweeperLazy } from '../../domain/sweeper.js';
import { getNotesForTicket } from '../../domain/notesRepo.js';
import { workingMinutesBetween } from '../../domain/businessTime.js';
import { formatRef, AgentTicketListItemDto } from '../dto.js';
import { requireAuth, requireLead } from '../auth.js';

export const agentTicketsRouter = Router();

// Apply requireAuth to all agent ticket routes
agentTicketsRouter.use(requireAuth);

// GET /api/tickets?view=mine|unassigned|all&q=
agentTicketsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await runSweeperLazy();

    const view = (req.query.view as string) || 'mine';
    const q = (req.query.q as string) || '';
    const userId = req.user!.id;
    const isLead = req.user!.role === 'lead';

    if (view === 'all' && !isLead) {
      throw new AppError(403, 'FORBIDDEN', 'Only lead can view all tickets');
    }

    const holidays = await getHolidays();
    const now = new Date();

    let sql = `
      SELECT t.*, a.name as assignee_name,
             (SELECT m.body FROM messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) as last_public_preview
        FROM tickets t
        LEFT JOIN agents a ON t.assignee_id = a.id
       WHERE 1=1
    `;
    const params: unknown[] = [];

    if (view === 'mine') {
      params.push(userId);
      sql += ` AND t.assignee_id = $${params.length}`;
    } else if (view === 'unassigned') {
      sql += ` AND t.assignee_id IS NULL AND t.status IN ('open')`;
    }

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      const pIdx = params.length;
      sql += ` AND (t.subject ILIKE $${pIdx} OR t.customer_name ILIKE $${pIdx} OR t.customer_email ILIKE $${pIdx})`;
    }

    sql += ` ORDER BY t.created_at DESC`;

    const ticketRes = await query<TicketRow & { assignee_name: string | null; last_public_preview: string | null }>(
      sql,
      params
    );

    const items: AgentTicketListItemDto[] = ticketRes.rows.map((row) => {
      const sla = computeSlaState(row, now, holidays);
      let reopenableUntil: string | null = null;
      if (row.status === 'resolved' && row.resolved_at) {
        const limit = new Date(new Date(row.resolved_at).getTime() + SLA.reopenWindowDays * 24 * 60 * 60 * 1000);
        reopenableUntil = limit.toISOString();
      }

      return {
        id: row.id,
        ref: formatRef(row.id),
        subject: row.subject,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        priority: row.priority,
        status: row.status,
        assigneeId: row.assignee_id,
        assigneeName: row.assignee_name || null,
        createdAt: new Date(row.created_at).toISOString(),
        sla,
        lastPublicPreview: row.last_public_preview || null,
        pausedAt: row.paused_at ? new Date(row.paused_at).toISOString() : null,
        reopenableUntil,
      };
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/export.csv (Lead only, INC-0304: NEVER notes)
agentTicketsRouter.get('/export.csv', requireLead, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const holidays = await getHolidays();
    const now = new Date();

    const result = await query<TicketRow & { assignee_name: string | null }>(
      `SELECT t.*, a.name as assignee_name
         FROM tickets t
         LEFT JOIN agents a ON t.assignee_id = a.id
        ORDER BY t.id ASC`
    );

    let csv = 'Ticket Ref,Customer Name,Customer Email,Subject,Priority,Status,Assignee,SLA Status,Created At IST,Resolved At IST\n';

    for (const t of result.rows) {
      const sla = computeSlaState(t, now, holidays);
      const slaDesc = sla.late ? 'LATE' : sla.resolution.state;
      const createdIst = new Date(t.created_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST';
      const resolvedIst = t.resolved_at
        ? new Date(t.resolved_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST'
        : 'N/A';

      const row = [
        formatRef(t.id),
        `"${t.customer_name.replace(/"/g, '""')}"`,
        `"${t.customer_email.replace(/"/g, '""')}"`,
        `"${t.subject.replace(/"/g, '""')}"`,
        t.priority,
        t.status,
        `"${(t.assignee_name || 'Unassigned').replace(/"/g, '""')}"`,
        slaDesc,
        `"${createdIst}"`,
        `"${resolvedIst}"`,
      ].join(',');
      csv += row + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="frontdesk_tickets.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:id: Ticket detail
agentTicketsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) {
      throw new AppError(400, 'INVALID_ID', 'Invalid ticket ID');
    }

    await runSweeperLazy();
    const holidays = await getHolidays();
    const now = new Date();

    const ticketRes = await query<TicketRow & { assignee_name: string | null }>(
      `SELECT t.*, a.name as assignee_name
         FROM tickets t
         LEFT JOIN agents a ON t.assignee_id = a.id
        WHERE t.id = $1`,
      [ticketId]
    );

    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const ticket = ticketRes.rows[0];
    const sla = computeSlaState(ticket, now, holidays);

    // Public messages
    const msgRes = await query<{
      id: number;
      author_type: 'customer' | 'agent';
      author_agent_id: string | null;
      agent_name: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT m.id, m.author_type, m.author_agent_id, a.name as agent_name, m.body, m.created_at
         FROM messages m
         LEFT JOIN agents a ON m.author_agent_id = a.id
        WHERE m.ticket_id = $1
        ORDER BY m.id ASC`,
      [ticketId]
    );

    // Internal notes (agents only)
    const notes = await getNotesForTicket(ticketId);

    res.json({
      ticket: {
        ...ticket,
        ref: formatRef(ticket.id),
      },
      sla,
      messages: msgRes.rows,
      notes,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/claim
agentTicketsRouter.post('/:id/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const updated = await claimTicket(ticketId, req.user!.id);
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/release
agentTicketsRouter.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const updated = await releaseTicket(ticketId, req.user!.id, req.user!.role === 'lead');
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/assign
agentTicketsRouter.post('/:id/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const { agentId } = req.body;
    if (!agentId) {
      throw new AppError(400, 'INVALID_INPUT', 'Target agentId is required');
    }
    const updated = await assignTicket(ticketId, agentId, req.user!.id, req.user!.role === 'lead');
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/replies
agentTicketsRouter.post('/:id/replies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const { body, waitForCustomer } = req.body;
    if (!body || !String(body).trim()) {
      throw new AppError(400, 'INVALID_INPUT', 'Reply body cannot be empty');
    }
    const result = await sendAgentReply(
      ticketId,
      req.user!.id,
      String(body).trim(),
      Boolean(waitForCustomer),
      req.user!.role === 'lead'
    );
    res.json({ ok: true, ticket: result.ticket, messageId: result.messageId });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/notes
agentTicketsRouter.post('/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const { body } = req.body;
    if (!body || !String(body).trim()) {
      throw new AppError(400, 'INVALID_INPUT', 'Note body cannot be empty');
    }
    const result = await addNote(ticketId, req.user!.id, String(body).trim(), req.user!.role === 'lead');
    res.json({ ok: true, noteId: result.noteId });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/priority
agentTicketsRouter.post('/:id/priority', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const { priority, reason } = req.body;
    if (!['urgent', 'medium', 'low'].includes(priority)) {
      throw new AppError(400, 'INVALID_INPUT', 'Priority must be urgent, medium, or low');
    }
    const updated = await changePriority(
      ticketId,
      req.user!.id,
      priority as Priority,
      reason ? String(reason).trim() : undefined,
      req.user!.role === 'lead'
    );
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/resolve
agentTicketsRouter.post('/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const updated = await resolveTicket(ticketId, req.user!.id, req.user!.role === 'lead');
    res.json({ ok: true, ticket: updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:id/events (Audit timeline with IST and elapsed working minutes)
agentTicketsRouter.get('/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const holidays = await getHolidays();

    const ticketRes = await query<TicketRow>(
      `SELECT cycle_started_at, sla_start_at FROM tickets WHERE id = $1`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    }
    const cycleStart = new Date(ticketRes.rows[0].sla_start_at);

    const eventRes = await query<{
      id: number;
      seq: number;
      type: string;
      actor_type: string;
      actor_id: string | null;
      actor_name: string | null;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT e.id, e.seq, e.type, e.actor_type, e.actor_id, a.name as actor_name, e.payload, e.occurred_at
         FROM ticket_events e
         LEFT JOIN agents a ON e.actor_id = a.id
        WHERE e.ticket_id = $1
        ORDER BY e.seq ASC`,
      [ticketId]
    );

    const events = eventRes.rows.map((ev) => {
      const occurred = new Date(ev.occurred_at);
      const wmElapsed = Math.round(workingMinutesBetween(cycleStart, occurred, holidays));
      const occurredIst = occurred.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST';

      return {
        seq: ev.seq,
        type: ev.type,
        actorType: ev.actor_type,
        actorName: ev.actor_name || (ev.actor_type === 'customer' ? 'Customer' : 'System'),
        payload: ev.payload,
        occurredAt: occurred.toISOString(),
        occurredAtIst: occurredIst,
        workingMinutesSinceCycleStart: Math.max(0, wmElapsed),
      };
    });

    res.json({ events });
  } catch (err) {
    next(err);
  }
});
