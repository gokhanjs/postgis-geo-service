import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Migrations run as an owner/superuser: they create extensions, roles and
// policies. The service itself connects as the restricted role created in 002,
// which is the only way row-level security applies to it at all.
const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.MIGRATION_DB_USER ?? 'postgres',
  password: process.env.MIGRATION_DB_PASS ?? 'postgres',
};

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const SAFE_DB_NAME = /^[a-zA-Z0-9_]+$/;

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/**
 * Creates the target database when it is missing.
 *
 * CREATE DATABASE cannot run inside a transaction and cannot take the name as a
 * bind parameter, so this connects to the system database and interpolates the
 * name. The allowlist check below is what keeps that safe.
 */
async function ensureDatabase(name: string): Promise<void> {
  const adminPool = new pg.Pool({ ...DB_CONFIG, database: 'postgres' });

  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (rows.length > 0) {
      console.log(`[db] "${name}" already exists.`);
      return;
    }

    if (!SAFE_DB_NAME.test(name)) {
      throw new Error('Unsafe database name. Use letters, digits and underscore only.');
    }

    await adminPool.query(`CREATE DATABASE ${name}`);
    console.log(`[db] created "${name}".`);
  } finally {
    await adminPool.end();
  }
}

function migrationFiles(): { up: string[]; down: string[] } {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return {
    up: files.filter((f) => f.includes('.do.')),
    down: files.filter((f) => f.includes('.undo.')),
  };
}

function versionOf(filename: string): string {
  return filename.split('.')[0] as string;
}

async function appliedVersions(client: pg.PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  return new Set(rows.map((r) => r.version));
}

async function runUp(client: pg.PoolClient): Promise<void> {
  const applied = await appliedVersions(client);
  const pending = migrationFiles().up.filter((f) => !applied.has(versionOf(f)));

  if (pending.length === 0) {
    console.log('Nothing to apply, the database is up to date.');
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[up] ${file}`);

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)', [
      versionOf(file),
      file,
    ]);
    await client.query('COMMIT');
  }

  console.log('Migration complete.');
}

async function runDown(client: pg.PoolClient): Promise<void> {
  const applied = await appliedVersions(client);
  if (applied.size === 0) {
    console.log('Nothing to roll back.');
    return;
  }

  const lastVersion = [...applied].sort().pop() as string;
  const undoFile = migrationFiles().down.find((f) => f.startsWith(lastVersion));

  if (undoFile === undefined) {
    throw new Error(`No undo file found for version ${lastVersion}.`);
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, undoFile), 'utf8');
  console.log(`[down] ${undoFile}`);

  await client.query('BEGIN');
  await client.query(sql);
  await client.query('DELETE FROM schema_migrations WHERE version = $1', [lastVersion]);
  await client.query('COMMIT');

  console.log('Rollback complete.');
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (command !== 'up' && command !== 'down') {
    throw new Error('Invalid command. Usage: node scripts/migrate.ts [up|down]');
  }

  const name = process.env.DB_NAME;
  if (name === undefined) throw new Error('DB_NAME is not set.');

  await ensureDatabase(name);

  const pool = new pg.Pool({ ...DB_CONFIG, database: name });
  const client = await pool.connect();

  try {
    await client.query(ENSURE_TABLE);
    await (command === 'up' ? runUp(client) : runDown(client));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
