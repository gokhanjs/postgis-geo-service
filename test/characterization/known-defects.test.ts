import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { createApiKey, resetDatabase, squarePolygon } from '../helpers/fixtures.js';

/**
 * Guards the defects this project has already closed. Each test previously
 * asserted the broken behaviour and was inverted by the phase that fixed it.
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

describe('F-01: geofence ownership stops at the tenant boundary', () => {
  it('keeps two tenants apart when they choose the same identifier', async () => {
    const keyA = await createApiKey(server.pool, TENANT_A, 'tenant-a');
    const keyB = await createApiKey(server.pool, TENANT_B, 'tenant-b');

    // Both tenants number their zones from their own upstream systems, so both
    // first zones are id 1. Under the old schema that was a global primary key
    // and the second write took the first tenant's row over.
    const createdByB = await syncZone(keyB, 1, 'b-restaurant', squarePolygon(29.0, 41.0));
    expect(createdByB.status).toBe(200);

    const createdByA = await syncZone(keyA, 1, 'a-restaurant', squarePolygon(32.0, 39.0));
    expect(createdByA.status).toBe(200);

    // Two rows, one per tenant, each still owned by whoever wrote it.
    const { rows } = await server.pool.query(
      'SELECT tenant_id, entity_id FROM geofences WHERE external_id = 1 ORDER BY tenant_id',
    );
    expect(rows).toEqual([
      { tenant_id: TENANT_A, entity_id: 'a-restaurant' },
      { tenant_id: TENANT_B, entity_id: 'b-restaurant' },
    ]);

    // And tenant B still finds the geofence it registered.
    const bLooksForItsZone = await fetch(
      `${server.baseUrl}/api/v1/geofences/containing?lat=41.0&lng=29.0&entity_type=restaurant`,
      { headers: { 'x-api-key': keyB } },
    );
    expect(await bLooksForItsZone.json()).toEqual({ results: [{ entity_id: 'b-restaurant' }] });
  });

  it('leaves another tenant geofence untouched when the same id is re-synced', async () => {
    const keyA = await createApiKey(server.pool, TENANT_A, 'tenant-a');
    const keyB = await createApiKey(server.pool, TENANT_B, 'tenant-b');

    await syncZone(keyB, 7, 'b-restaurant', squarePolygon(29.0, 41.0));
    await syncZone(keyA, 7, 'a-restaurant', squarePolygon(32.0, 39.0));

    // Tenant A updates its own id 7 repeatedly; B's row must never move.
    await syncZone(keyA, 7, 'a-restaurant-moved', squarePolygon(33.0, 38.0));

    const { rows } = await server.pool.query(
      'SELECT entity_id FROM geofences WHERE external_id = 7 AND tenant_id = $1',
      [TENANT_B],
    );
    expect(rows).toEqual([{ entity_id: 'b-restaurant' }]);
  });
});

describe('F-03: invalid geometry is refused at the door', () => {
  it('rejects a self-intersecting polygon instead of storing it', async () => {
    const key = await createApiKey(server.pool, TENANT_A, 'tenant-a');

    // A bowtie: schema-valid, geometrically invalid. Stored, it used to make
    // every later containment read for this tenant and type raise.
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [29.0, 41.0],
          [29.1, 41.1],
          [29.1, 41.0],
          [29.0, 41.1],
          [29.0, 41.0],
        ],
      ],
    };

    const res = await syncZone(key, 50, 'r1', bowtie);
    expect(res.status).toBe(400);

    const { rows } = await server.pool.query('SELECT count(*)::int AS n FROM geofences');
    expect(rows[0]).toEqual({ n: 0 });

    // The read path still answers for this tenant and type.
    const check = await fetch(
      `${server.baseUrl}/api/v1/geofences/containing?lat=41.05&lng=29.05&entity_type=restaurant`,
      { headers: { 'x-api-key': key } },
    );
    expect(check.status).toBe(200);
  });
});

function syncZone(apiKey: string, id: number, entityId: string, area: unknown) {
  return fetch(`${server.baseUrl}/api/v1/geofences/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      entity_id: entityId,
      entity_type: 'restaurant',
      area,
      is_active: true,
    }),
  });
}
