import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { adminPoolConfig, appPoolConfig } from '../helpers/env.js';

/**
 * Proves tenant isolation is a database guarantee rather than a convention.
 * Every query here deliberately omits a tenant predicate: what keeps the rows
 * apart is the policy, not the SQL.
 */

let admin: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  admin = new pg.Pool(adminPoolConfig);
  app = new pg.Pool(appPoolConfig);
});

afterAll(async () => {
  await admin?.end();
  await app?.end();
});

beforeEach(async () => {
  await admin.query('TRUNCATE entity_locations, geofences');
  await admin.query(
    `INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location)
     VALUES ('a1', 'restaurant', 1, ST_Point(29.0, 41.0, 4326)::geography),
            ('b1', 'restaurant', 2, ST_Point(32.0, 39.0, 4326)::geography)`,
  );
});

async function asTenant(tenantId: number | null, sql: string) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
    }
    const result = await client.query(sql);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

describe('row-level security', () => {
  it('is enabled on both spatial tables', async () => {
    const { rows } = await admin.query(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('entity_locations', 'geofences') ORDER BY relname`,
    );
    expect(rows).toEqual([
      { relname: 'entity_locations', relrowsecurity: true },
      { relname: 'geofences', relrowsecurity: true },
    ]);
  });

  it('does not constrain the migration role, which is why the service uses another', async () => {
    const { rows } = await admin.query('SELECT entity_id FROM entity_locations');
    expect(rows).toHaveLength(2);
  });

  it('returns nothing when the connection carries no tenant', async () => {
    const { rows } = await asTenant(null, 'SELECT entity_id FROM entity_locations');
    expect(rows).toEqual([]);
  });

  it('shows a tenant only its own rows, with no WHERE clause in the query', async () => {
    const first = await asTenant(1, 'SELECT entity_id FROM entity_locations');
    expect(first.rows).toEqual([{ entity_id: 'a1' }]);

    const second = await asTenant(2, 'SELECT entity_id FROM entity_locations');
    expect(second.rows).toEqual([{ entity_id: 'b1' }]);
  });

  it('refuses a write that would land in another tenant', async () => {
    await expect(
      asTenant(
        1,
        `INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location)
         VALUES ('smuggled', 'restaurant', 2, ST_Point(1, 1, 4326)::geography)`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete another tenant row', async () => {
    const updated = await asTenant(
      1,
      "UPDATE entity_locations SET is_active = false WHERE entity_id = 'b1'",
    );
    expect(updated.rowCount).toBe(0);

    const deleted = await asTenant(1, "DELETE FROM entity_locations WHERE entity_id = 'b1'");
    expect(deleted.rowCount).toBe(0);

    const { rows } = await admin.query(
      "SELECT is_active FROM entity_locations WHERE entity_id = 'b1'",
    );
    expect(rows).toEqual([{ is_active: true }]);
  });
});
