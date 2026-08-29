import fp from 'fastify-plugin';
import pg from 'pg';
import { config } from '../config/index.ts';

/**
 * Owns the connection pool and ties its lifetime to the server's.
 *
 * Closing the pool from Fastify's onClose hook rather than alongside it is what
 * makes shutdown safe: Fastify drains in-flight requests first, so no handler
 * is left holding a connection that has already gone away.
 */
export default fp(
  async (app) => {
    const pool = new pg.Pool(config.database);

    app.decorate('pg', pool);
    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'database' },
);
