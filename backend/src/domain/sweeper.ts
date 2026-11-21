import pg from 'pg';
import { pool } from '../db/pool.js';
import { addWorkingMinutes } from './businessTime.js';
import { SLA } from './sla.js';
import { getHolidays, TicketRow } from './ticketService.js';
import { insertAuditEvent } from './audit.js';

let lastLazyRun = 0;
const LAZY_THROTTLE_MS = 10000; // 10 seconds throttle

export async function detectBreaches(
  now = new Date(),
  clientOrPool: pg.PoolClient | pg.Pool = pool
): Promise<number> {
  let breachCount = 0;

  // 1. Detect response breaches
  const responseOverdue = await clientOrPool.query<TicketRow>(
    `SELECT *
       FROM tickets
      WHERE first_response_at IS NULL
        AND response_breached_at IS NULL
        AND response_due_at IS NOT NULL
        AND response_due_at < $1
        AND status IN ('open', 'waiting_on_customer')
      FOR UPDATE SKIP LOCKED`,
    [now]
  );

  for (const t of responseOverdue.rows) {
    await clientOrPool.query(
      `UPDATE tickets
          SET response_breached_at = response_due_at,
              version = version + 1
        WHERE id = $1`,
      [t.id]
    );

    await insertAuditEvent(clientOrPool, {
      ticketId: t.id,
      type: 'sla_breached',
      actorType: 'system',
      payload: {
        milestone: 'response',
        due_at: t.response_due_at,
        cause: 'no_first_reply',
      },
    });
    breachCount++;
  }

  // 2. Detect resolution breaches (only for open, non-paused tickets)
  const resolutionOverdue = await clientOrPool.query<TicketRow>(
    `SELECT *
       FROM tickets
      WHERE resolved_at IS NULL
        AND resolution_breached_at IS NULL
        AND resolution_due_at IS NOT NULL
        AND resolution_due_at < $1
        AND status = 'open'
      FOR UPDATE SKIP LOCKED`,
    [now]
  );

  for (const t of resolutionOverdue.rows) {
    await clientOrPool.query(
      `UPDATE tickets
          SET resolution_breached_at = resolution_due_at,
              version = version + 1
        WHERE id = $1`,
      [t.id]
    );

    await insertAuditEvent(clientOrPool, {
      ticketId: t.id,
      type: 'sla_breached',
      actorType: 'system',
      payload: {
        milestone: 'resolution',
        due_at: t.resolution_due_at,
        cause: 'slow_resolution',
      },
    });
    breachCount++;
  }

  return breachCount;
}

export async function autoClose(
  now = new Date(),
  clientOrPool: pg.PoolClient | pg.Pool = pool
): Promise<number> {
  let closeCount = 0;
  const holidays = await getHolidays(clientOrPool);

  // 1. Auto-close tickets waiting on customer for >= 2700 working minutes (5 working days)
  const waitingTickets = await clientOrPool.query<TicketRow>(
    `SELECT *
       FROM tickets
      WHERE status = 'waiting_on_customer'
        AND paused_at IS NOT NULL
      FOR UPDATE SKIP LOCKED`
  );

  for (const t of waitingTickets.rows) {
    const pauseStart = new Date(t.paused_at!);
    const autoCloseDue = addWorkingMinutes(pauseStart, SLA.autoCloseWaitingMin, holidays);

    if (now.getTime() >= autoCloseDue.getTime()) {
      await clientOrPool.query(
        `UPDATE tickets
            SET status = 'closed',
                closed_at = $1,
                close_reason = 'customer_unresponsive',
                version = version + 1
          WHERE id = $2`,
        [now, t.id]
      );

      await insertAuditEvent(clientOrPool, {
        ticketId: t.id,
        type: 'auto_closed',
        actorType: 'system',
        payload: {
          reason: 'customer_unresponsive',
          effective_at: autoCloseDue,
        },
      });
      closeCount++;
    }
  }

  // 2. Auto-close resolved tickets after 7 calendar days
  const sevenDaysAgo = new Date(now.getTime() - SLA.reopenWindowDays * 24 * 60 * 60 * 1000);
  const expiredResolved = await clientOrPool.query<TicketRow>(
    `SELECT *
       FROM tickets
      WHERE status = 'resolved'
        AND resolved_at IS NOT NULL
        AND resolved_at <= $1
      FOR UPDATE SKIP LOCKED`,
    [sevenDaysAgo]
  );

  for (const t of expiredResolved.rows) {
    await clientOrPool.query(
      `UPDATE tickets
          SET status = 'closed',
              closed_at = $1,
              close_reason = 'resolved_window_elapsed',
              version = version + 1
        WHERE id = $2`,
      [now, t.id]
    );

    await insertAuditEvent(clientOrPool, {
      ticketId: t.id,
      type: 'closed',
      actorType: 'system',
      payload: { reason: 'resolved_window_elapsed' },
    });
    closeCount++;
  }

  return closeCount;
}

export async function runSweeperCycle(now = new Date()): Promise<{ breaches: number; closed: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const breaches = await detectBreaches(now, client);
    const closed = await autoClose(now, client);
    await client.query('COMMIT');
    return { breaches, closed };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sweeper cycle error:', err);
    return { breaches: 0, closed: 0 };
  } finally {
    client.release();
  }
}

export async function runSweeperLazy(): Promise<void> {
  const now = Date.now();
  if (now - lastLazyRun < LAZY_THROTTLE_MS) {
    return;
  }
  lastLazyRun = now;
  await runSweeperCycle();
}

let timer: NodeJS.Timeout | null = null;

export function startSweeper(intervalMs = 60000): void {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      await runSweeperCycle();
    } catch (e) {
      console.error('Background sweeper error:', e);
    }
  }, intervalMs);
}

export function stopSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
