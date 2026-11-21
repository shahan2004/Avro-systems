import {
  Holidays,
  addWorkingMinutes,
  workingMinutesBetween,
  endOfWorkingDay,
  nextWorkingStart,
} from './businessTime.js';

export type Priority = 'urgent' | 'medium' | 'low';
export type TicketStatus = 'open' | 'waiting_on_customer' | 'resolved' | 'closed';

export const SLA = {
  urgent: { responseMin: 120, resolution: 'END_OF_DAY' as const },
  medium: { responseMin: 270, resolutionMin: 1620 },
  low: { responseMin: 540, resolutionMin: 2700 },
  autoCloseWaitingMin: 2700,
  reopenWindowDays: 7,
};

export interface SlaBudgets {
  responseBudgetMin: number;
  resolutionBudgetMin: number;
}

export function computeBudgets(priority: Priority, slaStartAt: Date, holidays: Holidays = new Set()): SlaBudgets {
  const normStart = nextWorkingStart(slaStartAt, holidays);
  if (priority === 'urgent') {
    const eod = endOfWorkingDay(normStart, holidays);
    const resolutionBudgetMin = Math.max(0, workingMinutesBetween(normStart, eod, holidays));
    return {
      responseBudgetMin: SLA.urgent.responseMin,
      resolutionBudgetMin,
    };
  }
  if (priority === 'medium') {
    return {
      responseBudgetMin: SLA.medium.responseMin,
      resolutionBudgetMin: SLA.medium.resolutionMin,
    };
  }
  return {
    responseBudgetMin: SLA.low.responseMin,
    resolutionBudgetMin: SLA.low.resolutionMin,
  };
}

export function computeDue(
  slaStartAt: Date,
  budgetMin: number,
  pausedWorkingMin: number,
  holidays: Holidays = new Set()
): Date {
  return addWorkingMinutes(slaStartAt, budgetMin + pausedWorkingMin, holidays);
}

export interface TicketSlaFields {
  priority: Priority;
  status: TicketStatus;
  sla_start_at: Date;
  paused_at?: Date | null;
  paused_working_minutes: number;
  response_due_at?: Date | null;
  resolution_due_at?: Date | null;
  first_response_at?: Date | null;
  response_breached_at?: Date | null;
  resolution_breached_at?: Date | null;
  resolved_at?: Date | null;
  closed_at?: Date | null;
}

export interface MilestoneState {
  state: 'met' | 'ok' | 'breached' | 'paused' | 'n/a';
  dueAt: Date | null;
  remainingWorkingMin: number;
}

export interface SlaStatus {
  response: MilestoneState;
  resolution: MilestoneState;
  late: boolean;
  everBreached: boolean;
}

export function computeSlaState(
  ticket: TicketSlaFields,
  now: Date,
  holidays: Holidays = new Set()
): SlaStatus {
  const everBreached = Boolean(ticket.response_breached_at || ticket.resolution_breached_at);

  // Response milestone evaluation
  let responseState: MilestoneState['state'] = 'ok';
  let responseRemaining = 0;
  const responseDue = ticket.response_due_at ? new Date(ticket.response_due_at) : null;

  if (ticket.first_response_at) {
    const firstResp = new Date(ticket.first_response_at);
    if (responseDue && firstResp.getTime() <= responseDue.getTime()) {
      responseState = 'met';
    } else {
      responseState = 'breached';
    }
  } else if (responseDue) {
    if (now.getTime() > responseDue.getTime()) {
      responseState = 'breached';
      responseRemaining = -workingMinutesBetween(responseDue, now, holidays);
    } else {
      responseState = 'ok';
      responseRemaining = workingMinutesBetween(now, responseDue, holidays);
    }
  } else {
    responseState = 'n/a';
  }

  // Resolution milestone evaluation
  let resolutionState: MilestoneState['state'] = 'ok';
  let resolutionRemaining = 0;
  const resolutionDue = ticket.resolution_due_at ? new Date(ticket.resolution_due_at) : null;

  if (ticket.status === 'closed') {
    resolutionState = 'n/a';
  } else if (ticket.resolved_at) {
    const resAt = new Date(ticket.resolved_at);
    if (resolutionDue && resAt.getTime() <= resolutionDue.getTime()) {
      resolutionState = 'met';
    } else {
      resolutionState = 'breached';
    }
  } else if (ticket.status === 'waiting_on_customer') {
    resolutionState = 'paused';
    // When paused, resolution_due_at may be null; remaining working minutes from paused_at to original target
    const budgets = computeBudgets(ticket.priority, new Date(ticket.sla_start_at), holidays);
    const targetDue = computeDue(
      new Date(ticket.sla_start_at),
      budgets.resolutionBudgetMin,
      ticket.paused_working_minutes,
      holidays
    );
    const effectiveNow = ticket.paused_at ? new Date(ticket.paused_at) : now;
    resolutionRemaining = Math.max(0, workingMinutesBetween(effectiveNow, targetDue, holidays));
  } else if (resolutionDue) {
    if (now.getTime() > resolutionDue.getTime()) {
      resolutionState = 'breached';
      resolutionRemaining = -workingMinutesBetween(resolutionDue, now, holidays);
    } else {
      resolutionState = 'ok';
      resolutionRemaining = workingMinutesBetween(now, resolutionDue, holidays);
    }
  } else {
    resolutionState = 'n/a';
  }

  // A ticket is considered "late" if any unmet clock is currently past due and NOT paused
  const responseLate = !ticket.first_response_at && responseDue && now.getTime() > responseDue.getTime();
  const resolutionLate =
    ticket.status === 'open' &&
    !ticket.resolved_at &&
    resolutionDue &&
    now.getTime() > resolutionDue.getTime();
  const late = Boolean(responseLate || resolutionLate);

  return {
    response: {
      state: responseState,
      dueAt: responseDue,
      remainingWorkingMin: Math.round(responseRemaining),
    },
    resolution: {
      state: resolutionState,
      dueAt: resolutionDue,
      remainingWorkingMin: Math.round(resolutionRemaining),
    },
    late,
    everBreached: everBreached || responseState === 'breached' || resolutionState === 'breached',
  };
}
