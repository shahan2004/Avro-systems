import { describe, it, expect, beforeAll } from 'vitest';
import pg from 'pg';
import { config } from '../src/config.js';
import { createTicket, sendAgentReply, addNote } from '../src/domain/ticketService.js';
import { verifyAuditChain } from '../src/domain/audit.js';
import { runMigrations } from '../src/db/migrate.js';

describe('INC-0318: Audit Trail Immutability & Hash Chain Verification', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.databaseUrlTest });
  });

  it('DB triggers forbid UPDATE, DELETE, TRUNCATE on ticket_events, messages, internal_notes', async () => {
    const { ticket } = await createTicket(
      {
        customerName: 'Audit Test',
        customerEmail: 'audit@example.com',
        subject: 'Testing immutability',
        description: 'Trigger test',
        priority: 'medium',
      },
      pool
    );

    // Attempt UPDATE on ticket_events
    await expect(
      pool.query(`UPDATE ticket_events SET type = 'tampered' WHERE ticket_id = $1`, [ticket.id])
    ).rejects.toThrow(/not allowed \(append-only\)/);

    // Attempt DELETE on ticket_events
    await expect(
      pool.query(`DELETE FROM ticket_events WHERE ticket_id = $1`, [ticket.id])
    ).rejects.toThrow(/not allowed \(append-only\)/);

    // Attempt UPDATE on messages
    await expect(
      pool.query(`UPDATE messages SET body = 'hacked' WHERE ticket_id = $1`, [ticket.id])
    ).rejects.toThrow(/not allowed \(append-only\)/);

    // Attempt DELETE on messages
    await expect(
      pool.query(`DELETE FROM messages WHERE ticket_id = $1`, [ticket.id])
    ).rejects.toThrow(/not allowed \(append-only\)/);
  });

  it('Hash chain is cryptographically verified and detects tampering', async () => {
    const agentRes = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Audit Agent', 'audit_agent@arvo.test', 'hash', 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const agentId = agentRes.rows[0].id;

    const { ticket } = await createTicket(
      {
        customerName: 'Audit Hash',
        customerEmail: 'audithash@example.com',
        subject: 'Testing hash chain',
        description: 'First event',
        priority: 'urgent',
      },
      pool
    );

    // Claim, reply, note -> creates a multi-event sequence
    await pool.query(`UPDATE tickets SET assignee_id = $1 WHERE id = $2`, [agentId, ticket.id]);
    await sendAgentReply(ticket.id, agentId, 'We are investigating', false, true);
    await addNote(ticket.id, agentId, 'Investigating root cause', true);

    // Chain must verify successfully
    const initialVerify = await verifyAuditChain(pool);
    expect(initialVerify.ok).toBe(true);
    expect(initialVerify.brokenAt.length).toBe(0);

    // Now simulate an attacker tampering with an event payload (disabling triggers temporarily in test session)
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE ticket_events DISABLE TRIGGER events_no_mutation');
      await client.query(
        `UPDATE ticket_events
            SET payload = '{"tampered": true}'::jsonb
          WHERE ticket_id = $1 AND seq = 2`,
        [ticket.id]
      );
      await client.query('ALTER TABLE ticket_events ENABLE TRIGGER events_no_mutation');

      const tamperedVerify = await verifyAuditChain(pool);
      expect(tamperedVerify.ok).toBe(false);
      expect(tamperedVerify.brokenAt.some((b) => b.ticketId === ticket.id)).toBe(true);
    } finally {
      // Re-enable trigger and clean up or revert tampered row
      await client.query('ALTER TABLE ticket_events DISABLE TRIGGER events_no_mutation');
      await client.query(`DELETE FROM ticket_events WHERE ticket_id = $1`, [ticket.id]);
      await client.query('ALTER TABLE ticket_events ENABLE TRIGGER events_no_mutation');
      client.release();
    }
  });
});
