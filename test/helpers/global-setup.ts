import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { poolConfig, testDbEnv } from './env.js';

const run = promisify(execFile);

/**
 * Applies the migration set to the test database once per `vitest run`.
 * Fails loudly when the database is unreachable, because the most common
 * cause is simply forgetting `pnpm db:up`.
 */
export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ ...poolConfig, connectionTimeoutMillis: 3000 });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach the test database "${testDbEnv.DB_NAME}" at ` +
        `${testDbEnv.DB_HOST}:${testDbEnv.DB_PORT} (${reason}).\n` +
        `Start it with:  pnpm db:up`,
      { cause: err },
    );
  } finally {
    await pool.end();
  }

  await run('node', ['migrate.js', 'up'], {
    env: { ...process.env, ...testDbEnv },
  });
}
