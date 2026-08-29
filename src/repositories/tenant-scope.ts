import type { Pool, PoolClient } from 'pg';

/**
 * Runs work with app.tenant_id set, transaction-locally: a pooled connection
 * outlives the request, so a session-level SET would leak into the next one.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: number,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);

    const result = await work(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
