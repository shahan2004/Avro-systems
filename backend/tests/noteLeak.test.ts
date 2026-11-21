import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createTicket, claimTicket, addNote } from '../src/domain/ticketService.js';
import { signToken } from '../src/http/auth.js';

describe('INC-0304: Private Team Note Leak Protection (Canary Test)', () => {
  const CANARY = 'CANARY-SECRET-9f3a-INTERNAL-ONLY-NEVER-LEAK';
  let app: ReturnType<typeof createApp>;
  let pool: pg.Pool;
  let leadToken: string;
  let agentToken: string;
  let ticketId: number;
  let portalToken: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: config.databaseUrlTest });
    app = createApp();

    // Create lead agent
    const leadRes = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Lead Manager', 'lead_canary@arvo.test', 'hash', 'lead')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const leadId = leadRes.rows[0].id;
    leadToken = signToken({ id: leadId, name: 'Lead Manager', email: 'lead_canary@arvo.test', role: 'lead' });

    // Create normal agent
    const agentRes = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Regular Agent', 'agent_canary@arvo.test', 'hash', 'agent')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const agentId = agentRes.rows[0].id;
    agentToken = signToken({ id: agentId, name: 'Regular Agent', email: 'agent_canary@arvo.test', role: 'agent' });

    // Create ticket
    const ticketData = await createTicket(
      {
        customerName: 'Canary Customer',
        customerEmail: 'canary@customer.test',
        subject: 'Confidential inquiry',
        description: 'Customer initial message body',
        priority: 'urgent',
      },
      pool
    );
    ticketId = ticketData.ticket.id;
    portalToken = ticketData.portalToken;

    // Claim ticket
    await claimTicket(ticketId, agentId, pool);

    // Add private team note containing CANARY secret!
    await addNote(
      ticketId,
      agentId,
      `Special instructions: ${CANARY}. Do not reveal that customer is vip.`
    );
  });

  it('1. GET /api/portal/tickets/:token does not contain canary', async () => {
    const res = await request(app).get(`/api/portal/tickets/${portalToken}`);
    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(CANARY);
    expect(bodyStr).not.toContain('CANARY-SECRET');
  });

  it('2. GET /api/portal/tickets/:token/transcript.txt does not contain canary', async () => {
    const res = await request(app).get(`/api/portal/tickets/${portalToken}/transcript.txt`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(CANARY);
    expect(res.text).not.toContain('CANARY-SECRET');
  });

  it('3. POST /api/portal/tickets/:token/replies does not leak canary in response or errors', async () => {
    const res = await request(app)
      .post(`/api/portal/tickets/${portalToken}/replies`)
      .send({ body: 'Customer reply' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
  });

  it('4. Lead CSV export GET /api/tickets/export.csv does not contain canary note text', async () => {
    const res = await request(app)
      .get('/api/tickets/export.csv')
      .set('Authorization', `Bearer ${leadToken}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(CANARY);
    expect(res.text).not.toContain('CANARY-SECRET');
  });

  it('5. Error responses do not leak canary string', async () => {
    const res = await request(app)
      .post(`/api/portal/tickets/invalid-token-12345/replies`)
      .send({ body: 'test' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
  });

  it('6. Audit events table payloads do not store note bodies (only note_id)', async () => {
    const eventRes = await pool.query<{ payload: any }>(
      `SELECT payload FROM ticket_events WHERE ticket_id = $1`,
      [ticketId]
    );
    for (const row of eventRes.rows) {
      const payloadStr = JSON.stringify(row.payload);
      expect(payloadStr).not.toContain(CANARY);
      expect(payloadStr).not.toContain('Special instructions');
    }
  });

  it('7. Agent ticket list preview uses last public message only, never note body', async () => {
    const res = await request(app)
      .get('/api/tickets?view=all')
      .set('Authorization', `Bearer ${leadToken}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((t: any) => t.id === ticketId);
    expect(item).toBeDefined();
    expect(item.lastPublicPreview).not.toContain(CANARY);
  });
});
