import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { adminPoolConfig, migrationEnv } from './env.js';

const run = promisify(execFile);

/**
 * Applies the migration set once per run. The probe targets the maintenance
 * database, since migrations are what create the test one.
 */
export default async function globalSetup(): Promise<void> {
  const pool = new Pool({
    ...adminPoolConfig,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach PostgreSQL at ${adminPoolConfig.host}:${adminPoolConfig.port} (${reason}).\n` +
        `Start it with:  pnpm db:up`,
      { cause: err },
    );
  } finally {
    await pool.end();
  }

  await run('node', ['scripts/migrate.ts', 'up'], {
    env: { ...process.env, ...migrationEnv },
  });
}
