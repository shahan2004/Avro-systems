import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../db/pool.js';
import { requireAuth, requireLead } from '../auth.js';
import { computeSlaState } from '../../domain/sla.js';
import { getHolidays, TicketRow } from '../../domain/ticketService.js';
import { formatRef } from '../dto.js';
import { runSweeperLazy } from '../../domain/sweeper.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(requireLead);

// GET /api/reports/sla: Managers SLA analytics and late-ticket drilldown ("which were late and why")
reportsRouter.get('/sla', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await runSweeperLazy();
    const holidays = await getHolidays();
    const now = new Date();

    const ticketsRes = await query<TicketRow & { assignee_name: string | null }>(
      `SELECT t.*, a.name as assignee_name
         FROM tickets t
         LEFT JOIN agents a ON t.assignee_id = a.id
        ORDER BY t.created_at DESC`
    );

    const breachEventsRes = await query<{
      ticket_id: number;
      payload: { milestone?: string; cause?: string; due_at?: string };
    }>(
      `SELECT ticket_id, payload
         FROM ticket_events
        WHERE type = 'sla_breached'
        ORDER BY seq ASC`
    );

    const breachCauseMap = new Map<number, string[]>();
    for (const b of breachEventsRes.rows) {
      if (!breachCauseMap.has(b.ticket_id)) {
        breachCauseMap.set(b.ticket_id, []);
      }
      const cause = b.payload.cause || 'sla_breached';
      breachCauseMap.get(b.ticket_id)!.push(cause);
    }

    const totalTickets = ticketsRes.rows.length;
    let lateTicketsCount = 0;
    let onTimeTicketsCount = 0;

    const byPriority: Record<string, { total: number; late: number }> = {
      urgent: { total: 0, late: 0 },
      medium: { total: 0, late: 0 },
      low: { total: 0, late: 0 },
    };

    const byAgent: Record<string, { agentName: string; total: number; late: number }> = {};
    const lateList: Array<{
      id: number;
      ref: string;
      subject: string;
      priority: string;
      status: string;
      assigneeName: string;
      causes: string[];
      responseState: string;
      resolutionState: string;
    }> = [];

    for (const t of ticketsRes.rows) {
      const sla = computeSlaState(t, now, holidays);
      const isLate = sla.everBreached || sla.late;

      if (isLate) {
        lateTicketsCount++;
      } else {
        onTimeTicketsCount++;
      }

      if (byPriority[t.priority]) {
        byPriority[t.priority].total++;
        if (isLate) byPriority[t.priority].late++;
      }

      const agentKey = t.assignee_id || 'unassigned';
      const agentName = t.assignee_name || 'Unassigned';
      if (!byAgent[agentKey]) {
        byAgent[agentKey] = { agentName, total: 0, late: 0 };
      }
      byAgent[agentKey].total++;
      if (isLate) byAgent[agentKey].late++;

      if (isLate) {
        const causes = breachCauseMap.get(t.id) || [sla.response.state === 'breached' ? 'no_first_reply' : 'slow_resolution'];
        lateList.push({
          id: t.id,
          ref: formatRef(t.id),
          subject: t.subject,
          priority: t.priority,
          status: t.status,
          assigneeName: t.assignee_name || 'Unassigned',
          causes,
          responseState: sla.response.state,
          resolutionState: sla.resolution.state,
        });
      }
    }

    const latePercentage = totalTickets > 0 ? Math.round((lateTicketsCount / totalTickets) * 100) : 0;
    const onTimePercentage = 100 - latePercentage;

    res.json({
      summary: {
        totalTickets,
        lateTicketsCount,
        onTimeTicketsCount,
        latePercentage,
        onTimePercentage,
      },
      byPriority,
      byAgent: Object.values(byAgent),
      lateTickets: lateList,
    });
  } catch (err) {
    next(err);
  }
});
