import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from '../config.js';
import { createPool } from './pool.js';

export async function runMigrations(customPool?: pg.Pool): Promise<void> {
  const p = customPool || createPool();
  const client = await p.connect();

  try {
    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    console.log(`Running ${files.length} migrations...`);
    for (const file of files) {
      console.log(`Executing migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
    }
    console.log('All migrations applied successfully.');
  } finally {
    client.release();
    if (!customPool) {
      await p.end();
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
