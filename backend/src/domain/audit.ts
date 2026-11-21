import crypto from 'crypto';
import pg from 'pg';
import { pool } from '../db/pool.js';

export interface AuditEvent {
  id: number;
  ticket_id: number;
  seq: number;
  type: string;
  actor_type: 'agent' | 'customer' | 'system';
  actor_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
  prev_hash: string;
  hash: string;
}

export interface AuditVerificationResult {
  ok: boolean;
  brokenAt: Array<{ ticketId: number; seq: number; reason: string }>;
}

export function computeEventHash(
  prevHash: string,
  ticketId: number,
  seq: number,
  type: string,
  actorType: string,
  actorId: string | null,
  payload: Record<string, unknown>,
  occurredAt: Date
): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const padMs = (n: number) => String(n).padStart(6, '0'); // microseconds in PG to_char .US

  const year = occurredAt.getUTCFullYear();
  const month = pad(occurredAt.getUTCMonth() + 1);
  const day = pad(occurredAt.getUTCDate());
  const hours = pad(occurredAt.getUTCHours());
  const minutes = pad(occurredAt.getUTCMinutes());
  const seconds = pad(occurredAt.getUTCSeconds());
  // Postgres .US format is microseconds (6 digits)
  const us = padMs(occurredAt.getUTCMilliseconds() * 1000);
  const formattedOccurredAt = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${us}Z`;

  const raw = `${prevHash}|${ticketId}|${seq}|${type}|${actorType}|${actorId || ''}|${JSON.stringify(payload)}|${formattedOccurredAt}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function insertAuditEvent(
  client: pg.PoolClient | pg.Pool,
  params: {
    ticketId: number;
    type: string;
    actorType: 'agent' | 'customer' | 'system';
    actorId?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  // DB trigger 'events_chain' automatically computes seq, prev_hash, occurred_at, and hash!
  // We insert dummy values for seq, prev_hash, occurred_at, hash which get overwritten.
  await client.query(
    `INSERT INTO ticket_events (ticket_id, seq, type, actor_type, actor_id, payload, occurred_at, prev_hash, hash)
     VALUES ($1, 0, $2, $3, $4, $5, now(), '', '')`,
    [
      params.ticketId,
      params.type,
      params.actorType,
      params.actorId || null,
      JSON.stringify(params.payload || {}),
    ]
  );
}

export async function verifyAuditChain(customPool?: pg.Pool): Promise<AuditVerificationResult> {
  const p = customPool || pool;
  const res = await p.query<AuditEvent>(
    `SELECT id, ticket_id, seq, type, actor_type, actor_id, payload, occurred_at, prev_hash, hash
       FROM ticket_events
      ORDER BY ticket_id ASC, seq ASC`
  );

  const brokenAt: Array<{ ticketId: number; seq: number; reason: string }> = [];
  const eventsByTicket = new Map<number, AuditEvent[]>();

  for (const ev of res.rows) {
    if (!eventsByTicket.has(ev.ticket_id)) {
      eventsByTicket.set(ev.ticket_id, []);
    }
    eventsByTicket.get(ev.ticket_id)!.push(ev);
  }

  for (const [ticketId, events] of eventsByTicket.entries()) {
    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const expectedSeq = i + 1;

      if (ev.seq !== expectedSeq) {
        brokenAt.push({
          ticketId,
          seq: ev.seq,
          reason: `Invalid sequence: expected ${expectedSeq}, found ${ev.seq}`,
        });
      }

      if (ev.prev_hash !== expectedPrevHash) {
        brokenAt.push({
          ticketId,
          seq: ev.seq,
          reason: `Hash chain broken: prev_hash does not match previous event hash`,
        });
      }

      // Recompute SHA-256 in SQL using the exact database row values
      const checkRes = await p.query<{ expected_hash: string }>(
        `SELECT encode(digest(
           $1 || '|' || ticket_id::text || '|' || seq::text || '|' || type || '|' ||
           actor_type || '|' || COALESCE(actor_id::text, '') || '|' || payload::text || '|' ||
           to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           'sha256'), 'hex') as expected_hash
         FROM ticket_events
        WHERE id = $2`,
        [ev.prev_hash, ev.id]
      );

      const dbComputedHash = checkRes.rows[0]?.expected_hash;
      if (ev.hash !== dbComputedHash) {
        brokenAt.push({
          ticketId,
          seq: ev.seq,
          reason: `Hash mismatch: row hash ${ev.hash} does not match computed ${dbComputedHash}`,
        });
      }

      expectedPrevHash = ev.hash;
    }
  }

  return {
    ok: brokenAt.length === 0,
    brokenAt,
  };
}
