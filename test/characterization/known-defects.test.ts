import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { createApiKey, resetDatabase, squarePolygon } from '../helpers/fixtures.js';

/**
 * Defects that exist today, pinned so the fix is provable.
 *
 * Each assertion here describes behaviour that is WRONG. The phase that fixes
 * the finding inverts the assertion, so the diff shows exactly which behaviour
 * changed and the suite never goes red in between.
 */

const TENANT_A = 1;
const TENANT_B = 2;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.stop();
});

beforeEach(async () => {
  await resetDatabase(server.pool);
});

describe('F-01: zone ownership crosses the tenant boundary', () => {
  it('lets one tenant overwrite and take over another tenant zone', async () => {
    const keyA = await createApiKey(server.pool, TENANT_A, 'tenant-a');
    const keyB = await createApiKey(server.pool, TENANT_B, 'tenant-b');

    // Tenant B registers the first zone it ever creates. Its id comes from
    // B's own upstream system, so a small integer is the norm, not an edge case.
    const created = await fetch(`${server.baseUrl}/api/v1/zones/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyB },
      body: JSON.stringify({
        id: 1,
        entity_id: 'b-restaurant',
        entity_type: 'restaurant',
        geojson: squarePolygon(29.0, 41.0),
        is_active: true,
      }),
    });
    expect(created.status).toBe(200);

    // Tenant A now syncs its own first zone, which naturally also carries id 1.
    const collided = await fetch(`${server.baseUrl}/api/v1/zones/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyA },
      body: JSON.stringify({
        id: 1,
        entity_id: 'a-restaurant',
        entity_type: 'restaurant',
        geojson: squarePolygon(32.0, 39.0),
        is_active: true,
      }),
    });

    // CURRENT BEHAVIOUR: the write is accepted and reported as a success.
    // TARGET (phase 2): 409, because id 1 already belongs to another tenant.
    expect(collided.status).toBe(200);
    expect(await collided.json()).toEqual({ success: true });

    // CURRENT BEHAVIOUR: the row now belongs to tenant A. Tenant B's zone is
    // gone, with no error raised on either side.
    // TARGET (phase 2): the row is untouched and still owned by tenant B.
    const { rows } = await server.pool.query('SELECT tenant_id, entity_id FROM zones WHERE id = 1');
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_A, entity_id: 'a-restaurant' });

    // The consequence, from tenant B's point of view: its zone silently vanished.
    const bLooksForItsZone = await fetch(
      `${server.baseUrl}/api/v1/zones/check?lat=41.0&lng=29.0&entity_type=restaurant`,
      { headers: { 'x-api-key': keyB } },
    );
    expect(await bLooksForItsZone.json()).toEqual([]);
  });
});
