import 'dotenv/config';
import pg from 'pg';
import { generateAdminToken } from '../src/lib/credentials.ts';

/**
 * Rotates the admin token. Only the digest is stored, so the value printed
 * here cannot be recovered from the database afterwards.
 */
async function main(): Promise<void> {
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASS ?? '',
    database: process.env.DB_NAME,
  });

  const { token, hash } = generateAdminToken();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM admin_tokens');
    await client.query('INSERT INTO admin_tokens (token_hash) VALUES ($1)', [hash]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\nAdmin token created. Store it now, it will not be shown again:\n');
  console.log(`  ${token}\n`);
  console.log('Any previously issued admin token has been revoked.\n');
}

try {
  await main();
} catch (err) {
  console.error('Failed to create admin token:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
