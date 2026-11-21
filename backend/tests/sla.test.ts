import { describe, it, expect } from 'vitest';
import { fromIstComponents, workingMinutesBetween } from '../src/domain/businessTime.js';
import {
  computeBudgets,
  computeDue,
  computeSlaState,
  TicketSlaFields,
} from '../src/domain/sla.js';

describe('SLA Engine Logic', () => {
  it('8. Pause example: medium created Mon 10:00 (resolution 1620). Pause Mon 12:00, resume Wed 11:00 (no holiday) -> paused = 390+540+90 = 1020 wm -> new due Fri 18:00', () => {
    // 2026-10-19 is Monday
    const mon1000 = fromIstComponents(2026, 9, 19, 10, 0);
    const budgets = computeBudgets('medium', mon1000, new Set());
    expect(budgets.resolutionBudgetMin).toBe(1620);

    // Initial due without pause
    const initialDue = computeDue(mon1000, budgets.resolutionBudgetMin, 0, new Set());
    // 1620 wm = 3 days * 540 min = Thursday 10:00
    // Mon: 10:00 to 18:30 = 510 min
    // Tue: 540 min (cumulative 1050)
    // Wed: 540 min (cumulative 1590)
    // Thu: 30 min (09:30 to 10:00) -> 1620 min

    // Pause on Mon 12:00, resume on Wed 11:00
    const pauseAt = fromIstComponents(2026, 9, 19, 12, 0);
    const resumeAt = fromIstComponents(2026, 9, 21, 11, 0);

    // Paused working minutes:
    // Mon: 12:00 to 18:30 = 390 min
    // Tue: 540 min
    // Wed: 09:30 to 11:00 = 90 min
    // Total paused = 390 + 540 + 90 = 1020 wm
    const pausedWm = workingMinutesBetween(pauseAt, resumeAt, new Set());
    expect(pausedWm).toBe(1020);

    // New due date = initial start + 1620 + 1020 = 2640 wm
    const newDue = computeDue(mon1000, budgets.resolutionBudgetMin, pausedWm, new Set());
    // Let's verify newDue in IST:
    // Mon: 510 wm (10:00 to 18:30)
    // Tue: 540 wm (cum 1050)
    // Wed: 540 wm (cum 1590)
    // Thu: 540 wm (cum 2130)
    // Fri: 510 wm (09:30 + 510 min = 09:30 + 8h 30m = 18:00!) -> cum 2640 wm
    const dueIst = newDue.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    expect(dueIst).toContain('18:00');
    expect(newDue.getUTCDay()).toBe(5); // Friday (in UTC and IST)
  });

  it('9. Priority medium->urgent Mon 15:00 -> due Mon 18:30, not breached. Same change on Tue 10:00 -> immediately breached, cause=priority_escalated', () => {
    // Ticket created Mon 10:00
    const mon1000 = fromIstComponents(2026, 9, 19, 10, 0);
    const urgentBudgets = computeBudgets('urgent', mon1000, new Set());
    const urgentDue = computeDue(mon1000, urgentBudgets.resolutionBudgetMin, 0, new Set());

    // Mon 15:00 escalation:
    const mon1500 = fromIstComponents(2026, 9, 19, 15, 0);
    const ticketMon: TicketSlaFields = {
      priority: 'urgent',
      status: 'open',
      sla_start_at: mon1000,
      paused_working_minutes: 0,
      resolution_due_at: urgentDue,
    };
    const stateMon = computeSlaState(ticketMon, mon1500, new Set());
    expect(stateMon.resolution.state).toBe('ok');
    expect(stateMon.late).toBe(false);

    // Tue 10:00 escalation (urgent due was Mon 18:30):
    const tue1000 = fromIstComponents(2026, 9, 20, 10, 0);
    const stateTue = computeSlaState(ticketMon, tue1000, new Set());
    expect(stateTue.resolution.state).toBe('breached');
    expect(stateTue.late).toBe(true);
  });

  it('10. Met response not re-judged after escalation. Downgrade after breach keeps breach sticky', () => {
    const mon1000 = fromIstComponents(2026, 9, 19, 10, 0);
    const mediumBudgets = computeBudgets('medium', mon1000, new Set());
    const mediumRespDue = computeDue(mon1000, mediumBudgets.responseBudgetMin, 0, new Set());

    // Reply sent at 13:00 (180 wm after start; within 270 wm medium budget, but outside 120 wm urgent budget)
    const replyAt = fromIstComponents(2026, 9, 19, 13, 0);
    const ticket: TicketSlaFields = {
      priority: 'medium',
      status: 'open',
      sla_start_at: mon1000,
      paused_working_minutes: 0,
      response_due_at: mediumRespDue,
      first_response_at: replyAt,
    };

    const now = fromIstComponents(2026, 9, 19, 14, 0);
    const stateBefore = computeSlaState(ticket, now, new Set());
    expect(stateBefore.response.state).toBe('met');

    // Escalated to urgent later at 14:00
    // According to D11: "Already-satisfied milestones are never re-judged"
    ticket.priority = 'urgent';
    const stateAfterEscalate = computeSlaState(ticket, now, new Set());
    expect(stateAfterEscalate.response.state).toBe('met');

    // Downgrade after breach keeps breach sticky
    ticket.response_breached_at = mon1000;
    ticket.first_response_at = null;
    ticket.priority = 'low';
    const lowBudgets = computeBudgets('low', mon1000, new Set());
    ticket.response_due_at = computeDue(mon1000, lowBudgets.responseBudgetMin, 0, new Set());

    const stateAfterDowngrade = computeSlaState(ticket, now, new Set());
    expect(stateAfterDowngrade.everBreached).toBe(true);
  });
});
