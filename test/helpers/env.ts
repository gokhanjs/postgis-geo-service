import 'dotenv/config';

/**
 * Connection settings for the dedicated integration-test database. Kept apart
 * from DB_NAME so a test run can never truncate development data.
 */
export const testDbEnv = {
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? '5432',
  DB_USER: process.env.DB_USER ?? 'postgres',
  DB_PASS: process.env.DB_PASS ?? 'postgres',
  DB_NAME: process.env.TEST_DB_NAME ?? 'geo_service_test',
};

export const poolConfig = {
  host: testDbEnv.DB_HOST,
  port: Number.parseInt(testDbEnv.DB_PORT, 10),
  user: testDbEnv.DB_USER,
  password: testDbEnv.DB_PASS,
  database: testDbEnv.DB_NAME,
};
