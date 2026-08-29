import 'dotenv/config';

const host = process.env.DB_HOST ?? '127.0.0.1';
const port = process.env.DB_PORT ?? '5432';
const database = process.env.TEST_DB_NAME ?? 'geo_service_test';

/** The restricted role, so RLS policies actually apply to the service. */
export const testDbEnv = {
  DB_HOST: host,
  DB_PORT: port,
  DB_USER: process.env.DB_USER ?? 'geo_app',
  DB_PASS: process.env.DB_PASS ?? 'geo_app',
  DB_NAME: database,
};

export const migrationEnv = {
  ...testDbEnv,
  MIGRATION_DB_USER: process.env.MIGRATION_DB_USER ?? 'postgres',
  MIGRATION_DB_PASS: process.env.MIGRATION_DB_PASS ?? 'postgres',
};

/** Fixtures need to cross tenants, which is what the service's role cannot. */
export const adminPoolConfig = {
  host,
  port: Number.parseInt(port, 10),
  user: process.env.MIGRATION_DB_USER ?? 'postgres',
  password: process.env.MIGRATION_DB_PASS ?? 'postgres',
  database,
};

/**
 * The service's own role, used by tests that need to prove what it cannot do.
 */
export const appPoolConfig = {
  host,
  port: Number.parseInt(port, 10),
  user: testDbEnv.DB_USER,
  password: testDbEnv.DB_PASS,
  database,
};
