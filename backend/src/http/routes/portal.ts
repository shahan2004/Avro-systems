import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { query } from '../../db/pool.js';
import {
  createTicket,
  customerReply,
  customerReopen,
  TicketRow,
  AppError,
} from '../../domain/ticketService.js';
import { Priority } from '../../domain/sla.js';
import { toPortalTicketDto, formatRef } from '../dto.js';
import { config } from '../../config.js';

export const portalRouter = Router();

// Rate limiting for portal actions
const portalCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // max 30 tickets created per window per IP
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later.' } },
});

// Map plain language severity to domain priority
function mapSeverity(severity: string): Priority {
  switch (severity) {
    case 'cannot_work':
      return 'urgent';
    case 'partly_blocked':
      return 'medium';
    case 'question':
    default:
      return 'low';
  }
}

// POST /api/portal/tickets: Create a new customer ticket
portalRouter.post('/tickets', portalCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, subject, description, severity, honeypot } = req.body;

    // Honeypot bot protection
    if (honeypot) {
      res.status(200).json({ ok: true });
      return;
    }

    if (!name || !email || !subject || !description) {
      throw new AppError(400, 'INVALID_INPUT', 'Name, email, subject, and description are required');
    }

    const priority = mapSeverity(severity);
    const { ticket, portalToken } = await createTicket({
      customerName: String(name).trim(),
      customerEmail: String(email).trim().toLowerCase(),
      subject: String(subject).trim(),
      description: String(description).trim(),
      priority,
    });

    const portalUrl = `${config.publicBaseUrl}/portal/t/${portalToken}`;
    res.status(201).json({
      ref: formatRef(ticket.id),
      portalUrl,
      token: portalToken,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/tickets/:token: View ticket via unguessable token
portalRouter.get('/tickets/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // INC-0304: Explicit columns from tickets. NEVER select internal notes!
    const ticketRes = await query<TicketRow>(
      `SELECT id, customer_name, customer_email, subject, priority, status,
              assignee_id, portal_token_hash, follow_up_of, version, cycle,
              created_at, cycle_started_at, sla_start_at, paused_at,
              paused_working_minutes, response_due_at, resolution_due_at,
              first_response_at, response_breached_at, resolution_breached_at,
              resolved_at, closed_at, close_reason, reopen_count
         FROM tickets
        WHERE portal_token_hash = $1`,
      [tokenHash]
    );

    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found or invalid link');
    }

    const ticket = ticketRes.rows[0];

    // Explicit columns from messages ONLY. Never joins internal_notes table.
    const msgRes = await query<{
      id: number;
      author_type: 'customer' | 'agent';
      agent_name: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT m.id, m.author_type, a.name as agent_name, m.body, m.created_at
         FROM messages m
         LEFT JOIN agents a ON m.author_agent_id = a.id
        WHERE m.ticket_id = $1
        ORDER BY m.id ASC`,
      [ticket.id]
    );

    const dto = toPortalTicketDto(ticket, msgRes.rows);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/tickets/:token/replies: Customer reply
portalRouter.post('/tickets/:token/replies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const { body } = req.body;
    if (!body || !String(body).trim()) {
      throw new AppError(400, 'INVALID_INPUT', 'Reply message body cannot be empty');
    }

    const result = await customerReply(token, String(body).trim());
    res.status(200).json({ ok: true, messageId: result.messageId });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/tickets/:token/reopen: Customer reopen
portalRouter.post('/tickets/:token/reopen', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const { reason } = req.body;
    const ticket = await customerReopen(token, reason ? String(reason).trim() : undefined);
    res.status(200).json({ ok: true, status: ticket.status, cycle: ticket.cycle });
  } catch (err) {
    next(err);
  }
});

// GET /api/portal/tickets/:token/transcript.txt: Download text transcript (INC-0304)
portalRouter.get('/tickets/:token/transcript.txt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const ticketRes = await query<TicketRow>(
      `SELECT id, customer_name, subject, created_at FROM tickets WHERE portal_token_hash = $1`,
      [tokenHash]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found or invalid link');
    }
    const ticket = ticketRes.rows[0];

    // Messages table ONLY
    const msgRes = await query<{
      author_type: string;
      agent_name: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT m.author_type, a.name as agent_name, m.body, m.created_at
         FROM messages m
         LEFT JOIN agents a ON m.author_agent_id = a.id
        WHERE m.ticket_id = $1
        ORDER BY m.id ASC`,
      [ticket.id]
    );

    let transcript = `TRANSCRIPT FOR TICKET ${formatRef(ticket.id)}\n`;
    transcript += `Subject: ${ticket.subject}\n`;
    transcript += `Created: ${ticket.created_at.toISOString()}\n`;
    transcript += `Customer: ${ticket.customer_name}\n`;
    transcript += '------------------------------------------------------------\n\n';

    for (const m of msgRes.rows) {
      const sender = m.author_type === 'customer' ? ticket.customer_name : `Support (${m.agent_name?.split(' ')[0] || 'Agent'})`;
      const dateStr = new Date(m.created_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST';
      transcript += `[${dateStr}] ${sender}:\n${m.body}\n\n`;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${formatRef(ticket.id)}-transcript.txt"`);
    res.send(transcript);
  } catch (err) {
    next(err);
  }
});

// POST /api/portal/tickets/:token/follow-up: Create follow-up for closed ticket
portalRouter.post('/tickets/:token/follow-up', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const ticketRes = await query<TicketRow>(
      `SELECT id, customer_name, customer_email, subject, status FROM tickets WHERE portal_token_hash = $1`,
      [tokenHash]
    );
    if (ticketRes.rowCount === 0) {
      throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found or invalid link');
    }
    const oldTicket = ticketRes.rows[0];

    const { subject, description, severity } = req.body;
    const sub = subject ? String(subject).trim() : `Follow-up to ${formatRef(oldTicket.id)}: ${oldTicket.subject}`;
    const desc = description ? String(description).trim() : 'Follow-up regarding previous closed ticket.';
    const priority = severity ? mapSeverity(severity) : 'medium';

    const { ticket, portalToken } = await createTicket({
      customerName: oldTicket.customer_name,
      customerEmail: oldTicket.customer_email,
      subject: sub,
      description: desc,
      priority,
      followUpOf: oldTicket.id,
    });

    const portalUrl = `${config.publicBaseUrl}/portal/t/${portalToken}`;
    res.status(201).json({
      ref: formatRef(ticket.id),
      portalUrl,
      token: portalToken,
    });
  } catch (err) {
    next(err);
  }
});
