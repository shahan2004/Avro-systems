import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export function createPool(connectionString?: string): pg.Pool {
  const connStr = connectionString || (process.env.NODE_ENV === 'test' ? config.databaseUrlTest : config.databaseUrl);
  return new Pool({
    connectionString: connStr,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export const pool = createPool();

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  customPool?: pg.Pool
): Promise<pg.QueryResult<T>> {
  const p = customPool || pool;
  return p.query<T>(text, params);
}
