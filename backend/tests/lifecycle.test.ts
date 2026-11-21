import { describe, it, expect, beforeAll } from 'vitest';
import pg from 'pg';
import { config } from '../src/config.js';
import {
  createTicket,
  claimTicket,
  sendAgentReply,
  customerReply,
  customerReopen,
  resolveTicket,
  AppError,
} from '../src/domain/ticketService.js';
import { autoClose } from '../src/domain/sweeper.js';
import { runMigrations } from '../src/db/migrate.js';
import { fromIstComponents, addWorkingMinutes } from '../src/domain/businessTime.js';

describe('Lifecycle & State Machine Rules (Tests 11-15)', () => {
  let pool: pg.Pool;
  let agentId: string;
  let otherAgentId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.databaseUrlTest });

    const a1 = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Lifecycle Agent 1', 'lc1@arvo.test', 'hash', 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    agentId = a1.rows[0].id;

    const a2 = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Lifecycle Agent 2', 'lc2@arvo.test', 'hash', 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    otherAgentId = a2.rows[0].id;
  });

  it('11. Waiting -> customer reply resumes, same assignee, pushes due date', async () => {
    const { ticket, portalToken } = await createTicket(
      {
        customerName: 'Waiting Customer',
        customerEmail: 'waiting@example.com',
        subject: 'Printer issue',
        description: 'Cannot print',
        priority: 'medium',
        createdAtOverride: fromIstComponents(2026, 9, 19, 10, 0), // Mon 10:00
      },
      pool
    );

    await claimTicket(ticket.id, agentId, pool);

    // Agent replies at Mon 11:00 and asks a question, setting waitForCustomer=true
    const pauseTime = fromIstComponents(2026, 9, 19, 11, 0);
    const { ticket: pausedTicket } = await sendAgentReply(
      ticket.id,
      agentId,
      'What is the printer error message?',
      true,
      false,
      pauseTime
    );

    expect(pausedTicket.status).toBe('waiting_on_customer');
    expect(pausedTicket.resolution_due_at).toBeNull();

    // Customer replies at Tue 11:00 (paused for exactly 1 working day = 540 wm)
    const replyTime = fromIstComponents(2026, 9, 20, 11, 0);
    const { ticket: resumedTicket } = await customerReply(portalToken, 'It says paper jam', replyTime);

    expect(resumedTicket.status).toBe('open');
    expect(resumedTicket.assignee_id).toBe(agentId); // Same assignee
    expect(resumedTicket.paused_working_minutes).toBe(540);
    expect(resumedTicket.resolution_due_at).not.toBeNull();
  });

  it('12. Waiting 2700 wm -> auto-closed (customer_unresponsive)', async () => {
    const { ticket } = await createTicket(
      {
        customerName: 'Ghost Customer',
        customerEmail: 'ghost@example.com',
        subject: 'Silent issue',
        description: 'Disappeared',
        priority: 'low',
        createdAtOverride: fromIstComponents(2026, 9, 19, 10, 0),
      },
      pool
    );

    await claimTicket(ticket.id, agentId, pool);
    const pauseTime = fromIstComponents(2026, 9, 19, 11, 0);
    await sendAgentReply(ticket.id, agentId, 'Hello? Are you there?', true, false, pauseTime);

    // Advance logical time by 2700 working minutes (5 working days) -> Mon 26 Oct 11:00
    const checkTime = addWorkingMinutes(pauseTime, 2700, new Set());
    const closedCount = await autoClose(checkTime, pool);

    expect(closedCount).toBeGreaterThanOrEqual(1);

    const ticketRes = await pool.query<{ status: string; close_reason: string }>(
      `SELECT status, close_reason FROM tickets WHERE id = $1`,
      [ticket.id]
    );
    expect(ticketRes.rows[0].status).toBe('closed');
    expect(ticketRes.rows[0].close_reason).toBe('customer_unresponsive');
  });

  it('13. Resolved -> reopen at day 6 OK (cycle 2); day 8 -> REOPEN_WINDOW_EXPIRED with follow-up hint', async () => {
    const { ticket, portalToken } = await createTicket(
      {
        customerName: 'Reopen Customer',
        customerEmail: 'reopen@example.com',
        subject: 'Resolved problem',
        description: 'Need help',
        priority: 'urgent',
      },
      pool
    );

    await claimTicket(ticket.id, agentId, pool);
    await sendAgentReply(ticket.id, agentId, 'Fixed your problem');
    const resolvedAt = new Date('2026-10-01T10:00:00Z');
    await resolveTicket(ticket.id, agentId, false, resolvedAt);

    // Reopen at Day 6 (reopen window is 7 calendar days)
    const day6 = new Date(resolvedAt.getTime() + 6 * 24 * 60 * 60 * 1000);
    const reopened = await customerReopen(portalToken, 'Still not working', day6);

    expect(reopened.status).toBe('open');
    expect(reopened.cycle).toBe(2);
    expect(reopened.reopen_count).toBe(1);

    // Resolve it again
    const resolvedAt2 = new Date('2026-10-08T10:00:00Z');
    await sendAgentReply(ticket.id, agentId, 'Fixed again');
    await resolveTicket(ticket.id, agentId, false, resolvedAt2);

    // Reopen attempt at Day 8 -> must fail with REOPEN_WINDOW_EXPIRED
    const day8 = new Date(resolvedAt2.getTime() + 8 * 24 * 60 * 60 * 1000);
    try {
      await customerReopen(portalToken, 'Broken again', day8);
      expect.fail('Should have thrown REOPEN_WINDOW_EXPIRED');
    } catch (e: any) {
      expect(e.code).toBe('REOPEN_WINDOW_EXPIRED');
      expect(e.extras.canCreateFollowUp).toBe(true);
    }
  });

  it('14. Resolve without public reply -> rejected (D15)', async () => {
    const { ticket } = await createTicket(
      {
        customerName: 'No Reply Customer',
        customerEmail: 'noreply@example.com',
        subject: 'Silent resolution attempt',
        description: 'Cannot resolve silently',
        priority: 'low',
      },
      pool
    );

    await claimTicket(ticket.id, agentId, pool);

    // Try to resolve directly without any agent public reply
    await expect(resolveTicket(ticket.id, agentId, false)).rejects.toThrow(
      /Cannot resolve a ticket without at least one public agent reply/
    );
  });

  it('15. Non-assignee reply -> 403; reply to unassigned -> 409', async () => {
    const { ticket } = await createTicket(
      {
        customerName: 'Permission Test',
        customerEmail: 'perm@example.com',
        subject: 'Permissions check',
        description: 'Check who can reply',
        priority: 'medium',
      },
      pool
    );

    // Unassigned ticket reply attempt -> 409 CLAIM_FIRST
    await expect(sendAgentReply(ticket.id, agentId, 'Replying unassigned')).rejects.toThrow(
      /Ticket must be claimed before replying/
    );

    // Claim by agentId
    await claimTicket(ticket.id, agentId, pool);

    // Reply by different agent (otherAgentId) -> 403 NOT_ASSIGNEE
    await expect(sendAgentReply(ticket.id, otherAgentId, 'Replying as wrong agent')).rejects.toThrow(
      /Only the assignee can reply/
    );
  });
});
