import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { ADMIN_TOKEN, createApiKey, resetDatabase, squarePolygon } from '../helpers/fixtures.js';

/**
 * The service's HTTP contract, asserted against the wire rather than the source
 * layout so the suite survives internal restructuring. Errors follow RFC 9457.
 */

const TENANT_A = 1;
const TENANT_B = 2;

let server: TestServer;
let keyA: string;
let keyB: string;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server?.stop();
});

beforeEach(async () => {
  await resetDatabase(server.pool);
  keyA = await createApiKey(server.pool, TENANT_A, 'tenant-a');
  keyB = await createApiKey(server.pool, TENANT_B, 'tenant-b');
});

function get(path: string, key?: string) {
  return fetch(`${server.baseUrl}${path}`, {
    headers: key ? { 'x-api-key': key } : {},
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('health', () => {
  it('reports ok and routing disabled when OSRM_URL is unset', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', osrm: 'disabled' });
  });
});

describe('authentication', () => {
  it('rejects a spatial request with no API key', async () => {
    const res = await get('/api/v1/entities/nearby?lat=41&lng=29&entity_type=restaurant');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ status: 401, title: 'Missing API key' });
  });

  it('rejects an unknown API key', async () => {
    const res = await get(
      '/api/v1/entities/nearby?lat=41&lng=29&entity_type=restaurant',
      'gsk_nope',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: 401, title: 'Invalid or inactive API key' });
  });

  it('rejects an admin request with no admin token', async () => {
    const res = await post('/api/v1/admin/keys', { tenant_id: 1, project_name: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('admin key management', () => {
  it('issues, lists and revokes a key', async () => {
    const created = await post(
      '/api/v1/admin/keys',
      { tenant_id: 7, project_name: 'acme-delivery' },
      { 'x-admin-token': ADMIN_TOKEN },
    );
    expect(created.status).toBe(200);
    const issued = (await created.json()) as { key: string };
    expect(issued.key).toMatch(/^gsk_[0-9a-f]{48}$/);

    // Listing shows a prefix, never the key: the stored value is a digest.
    const listed = await fetch(`${server.baseUrl}/api/v1/admin/keys`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    const rows = (await listed.json()) as Array<{ key_prefix: string; key?: string }>;
    const match = rows.find((r) => r.key_prefix === issued.key.slice(0, 12));
    expect(match).toBeDefined();
    expect(match?.key).toBeUndefined();

    const revoked = await fetch(`${server.baseUrl}/api/v1/admin/keys/${issued.key.slice(0, 12)}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(revoked.status).toBe(200);

    const afterRevoke = await get(
      '/api/v1/entities/nearby?lat=41&lng=29&entity_type=restaurant',
      issued.key,
    );
    expect(afterRevoke.status).toBe(401);
  });
});

describe('entities', () => {
  it('upserts a location and finds it within the radius', async () => {
    const synced = await post(
      '/api/v1/entities/sync',
      { entity_id: 'r1', entity_type: 'restaurant', lat: 41.0, lng: 29.0, is_active: true },
      { 'x-api-key': keyA },
    );
    expect(synced.status).toBe(200);
    expect(await synced.json()).toEqual({ success: true });

    const res = await get(
      '/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=restaurant&radius_km=1',
      keyA,
    );
    const rows = (await res.json()) as Array<{ entity_id: string; distance_km: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe('r1');
  });

  it('excludes entities beyond the radius', async () => {
    await post(
      '/api/v1/entities/sync',
      { entity_id: 'far', entity_type: 'restaurant', lat: 41.5, lng: 29.0, is_active: true },
      { 'x-api-key': keyA },
    );

    const res = await get(
      '/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=restaurant&radius_km=1',
      keyA,
    );
    expect(await res.json()).toEqual([]);
  });

  it('excludes inactive entities', async () => {
    await post(
      '/api/v1/entities/sync',
      { entity_id: 'off', entity_type: 'restaurant', lat: 41.0, lng: 29.0, is_active: false },
      { 'x-api-key': keyA },
    );

    const res = await get('/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=restaurant', keyA);
    expect(await res.json()).toEqual([]);
  });

  it('keeps one tenant from reading another tenant location', async () => {
    await post(
      '/api/v1/entities/sync',
      { entity_id: 'secret', entity_type: 'restaurant', lat: 41.0, lng: 29.0, is_active: true },
      { 'x-api-key': keyA },
    );

    const res = await get('/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=restaurant', keyB);
    expect(await res.json()).toEqual([]);
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await post(
      '/api/v1/entities/sync',
      { entity_id: 'bad', entity_type: 'restaurant', lat: 999, lng: 29.0, is_active: true },
      { 'x-api-key': keyA },
    );
    expect(res.status).toBe(400);
  });
});

describe('zones', () => {
  it('stores a polygon and reports the entities covering a point', async () => {
    await post(
      '/api/v1/zones/sync',
      {
        id: 100,
        entity_id: 'r1',
        entity_type: 'restaurant',
        geojson: squarePolygon(29.0, 41.0),
        is_active: true,
      },
      { 'x-api-key': keyA },
    );

    const res = await get('/api/v1/zones/check?lat=41.0&lng=29.0&entity_type=restaurant', keyA);
    expect(await res.json()).toEqual([{ entity_id: 'r1' }]);
  });

  it('answers the single-entity form with an inside flag', async () => {
    await post(
      '/api/v1/zones/sync',
      {
        id: 101,
        entity_id: 'r1',
        entity_type: 'restaurant',
        geojson: squarePolygon(29.0, 41.0),
        is_active: true,
      },
      { 'x-api-key': keyA },
    );

    const inside = await get(
      '/api/v1/zones/check?lat=41.0&lng=29.0&entity_type=restaurant&entity_id=r1',
      keyA,
    );
    expect(await inside.json()).toEqual({ inside: true });

    const outside = await get(
      '/api/v1/zones/check?lat=42.0&lng=29.0&entity_type=restaurant&entity_id=r1',
      keyA,
    );
    expect(await outside.json()).toEqual({ inside: false });
  });

  it('rejects a non-polygon geometry', async () => {
    const res = await post(
      '/api/v1/zones/sync',
      {
        id: 102,
        entity_id: 'r1',
        entity_type: 'restaurant',
        geojson: { type: 'Point', coordinates: [29.0, 41.0] },
        is_active: true,
      },
      { 'x-api-key': keyA },
    );
    expect(res.status).toBe(400);
  });

  it('deletes only within the calling tenant', async () => {
    await post(
      '/api/v1/zones/sync',
      {
        id: 103,
        entity_id: 'r1',
        entity_type: 'restaurant',
        geojson: squarePolygon(29.0, 41.0),
        is_active: true,
      },
      { 'x-api-key': keyA },
    );

    const foreign = await fetch(`${server.baseUrl}/api/v1/zones/103`, {
      method: 'DELETE',
      headers: { 'x-api-key': keyB },
    });
    expect(foreign.status).toBe(404);

    const own = await fetch(`${server.baseUrl}/api/v1/zones/103`, {
      method: 'DELETE',
      headers: { 'x-api-key': keyA },
    });
    expect(own.status).toBe(200);
  });
});

describe('routing', () => {
  it('answers 503 while OSRM is not configured', async () => {
    const res = await post(
      '/api/v1/routing/distances',
      {
        origin: { lat: 41.0, lng: 29.0 },
        destinations: [{ entity_id: 'r1', entity_type: 'restaurant' }],
      },
      { 'x-api-key': keyA },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 503,
      title: 'Routing is not configured',
    });
  });
});

describe('collection download', () => {
  it('answers 404 for an unknown token', async () => {
    const res = await get('/api/v1/collection/download/does-not-exist');
    expect(res.status).toBe(404);
  });
});
