import { describe, it, expect, beforeAll } from 'vitest';
import pg from 'pg';
import { config } from '../src/config.js';
import { createTicket, claimTicket, AppError } from '../src/domain/ticketService.js';
import { runMigrations } from '../src/db/migrate.js';

describe('INC-0291: Atomic Claim & Concurrency Race', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.databaseUrlTest });
  });

  it('20 parallel claims by different agents -> exactly one winner, 19 409 errors, exactly one claimed event', async () => {
    // 1. Create 20 agents
    const agentIds: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const email = `agent_race_${Date.now()}_${i}@arvo.test`;
      const res = await pool.query<{ id: string }>(
        `INSERT INTO agents (name, email, password_hash, role)
         VALUES ($1, $2, 'hash', 'agent')
         RETURNING id`,
        [`Agent ${i}`, email]
      );
      agentIds.push(res.rows[0].id);
    }

    // 2. Create one unassigned open ticket
    const { ticket } = await createTicket(
      {
        customerName: 'Alice Customer',
        customerEmail: 'alice@example.com',
        subject: 'Cannot login to portal',
        description: 'Help, I am locked out.',
        priority: 'urgent',
      },
      pool
    );

    // 3. Fire 20 parallel claims simultaneously
    const results = await Promise.allSettled(
      agentIds.map((agentId) => claimTicket(ticket.id, agentId, pool))
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 winner
    expect(fulfilled.length).toBe(1);
    // Exactly 19 losers
    expect(rejected.length).toBe(19);

    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(AppError);
        expect((r.reason as AppError).statusCode).toBe(409);
        expect((r.reason as AppError).code).toBe('ALREADY_CLAIMED');
        expect((r.reason as AppError).extras.assignedTo).toBeDefined();
      }
    }

    // Check DB state: exactly one claimed event in ticket_events
    const eventRes = await pool.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 AND type = 'claimed'`,
      [ticket.id]
    );
    expect(eventRes.rowCount).toBe(1);

    // Check ticket row has the winning agent
    const ticketCheck = await pool.query(
      `SELECT assignee_id, version FROM tickets WHERE id = $1`,
      [ticket.id]
    );
    const winningResult = fulfilled[0] as PromiseFulfilledResult<any>;
    expect(ticketCheck.rows[0].assignee_id).toBe(winningResult.value.assignee_id);
    expect(ticketCheck.rows[0].version).toBe(2); // 1 on creation, +1 on claim
  });
});
