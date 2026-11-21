import pg from 'pg';
import { query } from '../db/pool.js';

export interface InternalNote {
  id: number;
  ticket_id: number;
  author_agent_id: string;
  author_name?: string;
  body: string;
  created_at: Date;
}

export async function addInternalNote(
  client: pg.PoolClient | pg.Pool,
  params: {
    ticketId: number;
    authorAgentId: string;
    body: string;
  }
): Promise<InternalNote> {
  const res = await client.query<InternalNote>(
    `INSERT INTO internal_notes (ticket_id, author_agent_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, ticket_id, author_agent_id, body, created_at`,
    [params.ticketId, params.authorAgentId, params.body]
  );
  return res.rows[0];
}

export async function getNotesForTicket(
  ticketId: number,
  customPool?: pg.Pool
): Promise<InternalNote[]> {
  const res = await query<InternalNote>(
    `SELECT n.id, n.ticket_id, n.author_agent_id, a.name as author_name, n.body, n.created_at
       FROM internal_notes n
       JOIN agents a ON n.author_agent_id = a.id
      WHERE n.ticket_id = $1
      ORDER BY n.id ASC`,
    [ticketId],
    customPool
  );
  return res.rows;
}
