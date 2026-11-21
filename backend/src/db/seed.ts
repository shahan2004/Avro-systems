import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createPool } from './pool.js';
import { config } from '../config.js';
import { createTicket, claimTicket, sendAgentReply, addNote, resolveTicket } from '../domain/ticketService.js';
import { insertAuditEvent } from '../domain/audit.js';

export async function runSeed(customPool?: pg.Pool): Promise<void> {
  if (!config.allowDemoSeed) {
    console.log('Seed disabled by ALLOW_DEMO_SEED=false');
    return;
  }

  const p = customPool || createPool();
  const client = await p.connect();

  try {
    console.log('Seeding demo data for Arvo Systems Frontdesk...');
    const passwordHash = await bcrypt.hash('Frontdesk@123', 10);

    // 1. Seed Lead Meera
    const leadRes = await client.query<{ id: string }>(
      `INSERT INTO agents (name, email, password_hash, role)
       VALUES ('Meera Nair', 'meera@arvo.test', $1, 'lead')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'lead'
       RETURNING id`,
      [passwordHash]
    );
    const meeraId = leadRes.rows[0].id;

    // 2. Seed 9 Agents
    const agentData = [
      { name: 'Rahul Sharma', email: 'agent1@arvo.test' },
      { name: 'Priya Patel', email: 'agent2@arvo.test' },
      { name: 'Amit Verma', email: 'agent3@arvo.test' },
      { name: 'Sneha Rao', email: 'agent4@arvo.test' },
      { name: 'Rohan Gupta', email: 'agent5@arvo.test' },
      { name: 'Neha Joshi', email: 'agent6@arvo.test' },
      { name: 'Vikram Singh', email: 'agent7@arvo.test' },
      { name: 'Ananya Das', email: 'agent8@arvo.test' },
      { name: 'Arjun Menon', email: 'agent9@arvo.test' },
    ];

    const agentIds: string[] = [];
    for (const a of agentData) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO agents (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'agent')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [a.name, a.email, passwordHash]
      );
      agentIds.push(res.rows[0].id);
    }

    // 3. Seed Holidays
    await client.query(`
      INSERT INTO holidays (day, name) VALUES
        ('2026-12-25', 'Christmas Day'),
        ('2027-01-26', 'Republic Day'),
        ('2027-05-01', 'May Day'),
        ('2027-08-15', 'Independence Day')
      ON CONFLICT (day) DO NOTHING
    `);

    // 4. Seed ~12 Demo Tickets (only seed if tickets table is empty or has fewer than 5 tickets)
    const countRes = await client.query<{ count: string }>('SELECT count(*) as count FROM tickets');
    if (parseInt(countRes.rows[0].count, 10) >= 5) {
      console.log('Tickets already seeded, skipping ticket creation.');
      return;
    }

    console.log('Seeding demo tickets in various states...');

    // Ticket 1: Unassigned Urgent (Needs immediate attention)
    await createTicket(
      {
        customerName: 'Kavita Menon',
        customerEmail: 'kavita@acmecorp.example',
        subject: 'Database connection crashing production API server',
        description: 'Our backend cluster cannot connect to PostgreSQL since 20 minutes ago. 500 errors on all user requests!',
        priority: 'urgent',
      },
      client
    );

    // Ticket 2: Assigned Active Urgent (Rahul working on it)
    const t2 = await createTicket(
      {
        customerName: 'Siddharth Roy',
        customerEmail: 'siddharth@fintech.example',
        subject: 'Payment webhook returning signature mismatch',
        description: 'Orders are failing validation after the recent certificate renewal.',
        priority: 'urgent',
      },
      client
    );
    await claimTicket(t2.ticket.id, agentIds[0], client);
    await sendAgentReply(t2.ticket.id, agentIds[0], 'Hi Siddharth, looking into the webhook certificate bundle now.', false, false);

    // Ticket 3: Assigned & Late (breached)
    const t3 = await createTicket(
      {
        customerName: 'David Miller',
        customerEmail: 'david@global.example',
        subject: 'Cannot export CSV report from dashboard',
        description: 'The export button spins indefinitely and never downloads the file.',
        priority: 'medium',
        createdAtOverride: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      },
      client
    );
    await claimTicket(t3.ticket.id, agentIds[1], client);
    await client.query(
      `UPDATE tickets
          SET response_breached_at = now() - interval '3 days',
              resolution_breached_at = now() - interval '1 day'
        WHERE id = $1`,
      [t3.ticket.id]
    );
    await insertAuditEvent(client, {
      ticketId: t3.ticket.id,
      type: 'sla_breached',
      actorType: 'system',
      payload: { milestone: 'resolution', cause: 'slow_resolution' },
    });

    // Ticket 4: Waiting-on-customer (Paused clock)
    const t4 = await createTicket(
      {
        customerName: 'Elena Rostova',
        customerEmail: 'elena@nordic.example',
        subject: 'SSO configuration with Azure AD',
        description: 'We get an invalid SAML assertion when logging in through Azure portal.',
        priority: 'medium',
      },
      client
    );
    await claimTicket(t4.ticket.id, agentIds[2], client);
    await sendAgentReply(
      t4.ticket.id,
      agentIds[2],
      'Hi Elena, could you please provide the Azure AD Entity ID and Metadata XML so we can verify the trust relationship?',
      true, // pauses clock
      false
    );

    // Ticket 5: Resolved & Reopenable (Within 7-day window)
    const t5 = await createTicket(
      {
        customerName: 'Tanvi Shah',
        customerEmail: 'tanvi@retailhub.example',
        subject: 'Reset 2FA device for admin user',
        description: 'Admin lost their authentication phone. Need backup codes generated.',
        priority: 'medium',
      },
      client
    );
    await claimTicket(t5.ticket.id, agentIds[3], client);
    await sendAgentReply(t5.ticket.id, agentIds[3], 'Backup verification code dispatched to registered mobile. 2FA has been successfully reset.', false, false);
    await resolveTicket(t5.ticket.id, agentIds[3], false);

    // Ticket 6: Closed Unresponsive (Auto-closed after 5 working days)
    const t6 = await createTicket(
      {
        customerName: 'Mark Vance',
        customerEmail: 'mark@outreach.example',
        subject: 'Enquiry about custom email domain branding',
        description: 'Can we send notifications from our own domain?',
        priority: 'low',
        createdAtOverride: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      client
    );
    await claimTicket(t6.ticket.id, agentIds[4], client);
    await sendAgentReply(t6.ticket.id, agentIds[4], 'Yes, custom domains are supported. Please let us know your DNS provider.', true, false);
    await client.query(
      `UPDATE tickets
          SET status = 'closed',
              closed_at = now() - interval '2 days',
              close_reason = 'customer_unresponsive'
        WHERE id = $1`,
      [t6.ticket.id]
    );

    // Ticket 7: Closed Resolved Window Elapsed (> 7 days)
    const t7 = await createTicket(
      {
        customerName: 'Sunita Rao',
        customerEmail: 'sunita@techlabs.example',
        subject: 'Billing invoice copy for September',
        description: 'Need a copy of last month invoice with GSTIN included.',
        priority: 'low',
        createdAtOverride: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      },
      client
    );
    await claimTicket(t7.ticket.id, agentIds[5], client);
    await sendAgentReply(t7.ticket.id, agentIds[5], 'Attached is the revised invoice with GSTIN.', false, false);
    await client.query(
      `UPDATE tickets
          SET status = 'closed',
              resolved_at = now() - interval '14 days',
              closed_at = now() - interval '7 days',
              close_reason = 'resolved_window_elapsed'
        WHERE id = $1`,
      [t7.ticket.id]
    );

    // Ticket 8: Demonstrating INC-0304 isolation (Internal note with sensitive team instructions)
    const t8 = await createTicket(
      {
        customerName: 'Robert Vance',
        customerEmail: 'robert@refrigeration.example',
        subject: 'Urgent contract pricing renegotiation inquiry',
        description: 'We are evaluating whether to renew our enterprise tier contract next month.',
        priority: 'urgent',
      },
      client
    );
    await claimTicket(t8.ticket.id, meeraId, client);
    await addNote(
      t8.ticket.id,
      meeraId,
      'PRIVATE TEAM NOTE: Account value is $40k ARR. Offer up to 15% discount if they commit to 2-year term. Do NOT mention competitor match.',
      true
    );
    await sendAgentReply(t8.ticket.id, meeraId, 'Hello Robert, Meera here. We would love to discuss renewal options and have scheduled a callback.', false, true);

    // Tickets 9-12: Additional variety for testing
    const t9 = await createTicket(
      {
        customerName: 'Deepak Chopra',
        customerEmail: 'deepak@wellness.example',
        subject: 'Question regarding API rate limits',
        description: 'What is the standard requests per minute limit on the basic tier?',
        priority: 'low',
      },
      client
    );
    await claimTicket(t9.ticket.id, agentIds[6], client);
    await sendAgentReply(t9.ticket.id, agentIds[6], 'The basic tier limit is 120 requests per minute.', false, false);

    await createTicket(
      {
        customerName: 'Grace Hopper',
        customerEmail: 'grace@compilers.example',
        subject: 'Feature request: Webhook delivery retry backoff',
        description: 'Could you implement exponential backoff on failed webhook deliveries?',
        priority: 'low',
      },
      client
    );

    await createTicket(
      {
        customerName: 'Alan Turing',
        customerEmail: 'alan@cipher.example',
        subject: 'Memory leak in worker batch process',
        description: 'Worker memory grows by ~200MB per hour during large ingestion batches.',
        priority: 'medium',
      },
      client
    );

    const t12 = await createTicket(
      {
        customerName: 'Linus Torvalds',
        customerEmail: 'linus@kernel.example',
        subject: 'Git merge conflict resolution tool failing on binary assets',
        description: 'Binary 3D models fail three-way merge without warning.',
        priority: 'medium',
      },
      client
    );
    await claimTicket(t12.ticket.id, agentIds[7], client);

    console.log('Demo seed completed successfully.');
  } finally {
    client.release();
    if (!customPool) {
      await p.end();
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
