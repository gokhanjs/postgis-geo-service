import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issuedKeyFrom, runKeysCli } from '../helpers/keys-cli.js';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { createApiKey, resetDatabase, squarePolygon } from '../helpers/fixtures.js';

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
  server = await startTestServer({ OSRM_URL: '' });
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
  return fetch(`${server.baseUrl}${path}`, { headers: key ? { 'x-api-key': key } : {} });
}

function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function putEntity(key: string, type: string, id: string, body: unknown) {
  return send('PUT', `/api/v1/entities/${type}/${id}`, body, { 'x-api-key': key });
}

function putGeofence(key: string, id: number, body: unknown) {
  return send('PUT', `/api/v1/geofences/${id}`, body, { 'x-api-key': key });
}

function polygonBody(entityId: string, area: unknown) {
  return { entity_id: entityId, entity_type: 'site', area, is_active: true };
}

describe('health', () => {
  it('separates liveness from readiness', async () => {
    const live = await get('/health/live');
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });

    const ready = await get('/health/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok', osrm: 'disabled' });
  });
});

describe('documentation', () => {
  it('serves a spec generated from the route schemas', async () => {
    const res = await get('/docs/json');
    expect(res.status).toBe(200);

    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/entities/{type}/{id}',
        '/api/v1/entities/nearby',
        '/api/v1/geofences/{id}',
        '/api/v1/geofences/containing',
      ]),
    );
  });
});

describe('authentication', () => {
  it('rejects a request with no API key', async () => {
    const res = await get('/api/v1/entities/nearby?lat=41&lng=29&entity_type=site');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ status: 401, title: 'Missing API key' });
  });

  it('rejects an unknown API key', async () => {
    const res = await get('/api/v1/entities/nearby?lat=41&lng=29&entity_type=site', 'gsk_no');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ title: 'Invalid or inactive API key' });
  });
});

describe('key management CLI', () => {
  it('issues a key once, lists it by prefix, and revokes it', async () => {
    const issued = await runKeysCli(['issue', '--tenant', '7', '--project', 'acme-delivery']);
    expect(issued.code).toBe(0);
    const key = issuedKeyFrom(issued.stdout);
    const prefix = key.slice(0, 12);

    const listed = await runKeysCli(['list']);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(prefix);
    expect(listed.stdout).toContain('acme-delivery');
    expect(listed.stdout).not.toContain(key);

    // Revoked before first use: a key the service has already resolved stays
    // cached for up to a minute, which the CLI in another process cannot clear.
    const revoked = await runKeysCli(['revoke', prefix]);
    expect(revoked.code).toBe(0);

    const afterRevoke = await get('/api/v1/entities/nearby?lat=41&lng=29&entity_type=site', key);
    expect(afterRevoke.status).toBe(401);
  });

  it('fails without changing anything when the prefix matches no key', async () => {
    const res = await runKeysCli(['revoke', 'gsk_00000000']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('No key');
  });

  it.each([
    ['no tenant', ['--project', 'acme-delivery']],
    ['a tenant in exponent notation', ['--tenant', '1e3', '--project', 'acme-delivery']],
    ['a tenant past the column range', ['--tenant', '2147483648', '--project', 'acme-delivery']],
    ['a non-ASCII project', ['--tenant', '1', '--project', 'acme-teslimat-ş']],
    ['a project over 200 characters', ['--tenant', '1', '--project', 'x'.repeat(201)]],
    ['a misspelled flag', ['--tenent', '1', '--project', 'acme-delivery']],
  ])('refuses to issue a key given %s', async (_case, args) => {
    const res = await runKeysCli(['issue', ...args]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Usage:');
    const { rows } = await server.pool.query('SELECT 1 FROM api_keys WHERE tenant_id <> ALL($1)', [
      [TENANT_A, TENANT_B],
    ]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to revoke by a full key, which would land in shell history', async () => {
    const res = await runKeysCli(['revoke', keyA]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('prefix');
    expect((await get('/api/v1/entities/nearby?lat=41&lng=29&entity_type=site', keyA)).status).toBe(
      200,
    );
  });

  it('rejects an unknown command with the usage text', async () => {
    const res = await runKeysCli(['rotate']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Usage:');
  });
});

describe('entities', () => {
  it('stores a location and finds it within the radius', async () => {
    const put = await putEntity(keyA, 'site', 'r1', {
      lat: 41.0,
      lng: 29.0,
      is_active: true,
    });
    expect(put.status).toBe(200);

    const res = await get(
      '/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=site&radius_km=1',
      keyA,
    );
    const page = (await res.json()) as { results: Array<{ entity_id: string }> };
    expect(page.results.map((r) => r.entity_id)).toEqual(['r1']);
  });

  it('excludes entities beyond the radius and inactive ones', async () => {
    await putEntity(keyA, 'site', 'far', { lat: 41.5, lng: 29.0, is_active: true });
    await putEntity(keyA, 'site', 'off', { lat: 41.0, lng: 29.0, is_active: false });

    const res = await get(
      '/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=site&radius_km=1',
      keyA,
    );
    expect(await res.json()).toEqual({ results: [], next_cursor: null });
  });

  it('keeps one tenant from reading another tenant location', async () => {
    await putEntity(keyA, 'site', 'secret', { lat: 41.0, lng: 29.0, is_active: true });

    const res = await get('/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=site', keyB);
    expect(await res.json()).toEqual({ results: [], next_cursor: null });
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await putEntity(keyA, 'site', 'bad', {
      lat: 999,
      lng: 29.0,
      is_active: true,
    });
    expect(res.status).toBe(400);
  });

  it('walks results a page at a time', async () => {
    for (let i = 0; i < 5; i += 1) {
      await putEntity(keyA, 'site', `r${i}`, {
        lat: 41.0 + i * 0.001,
        lng: 29.0,
        is_active: true,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const url =
        '/api/v1/entities/nearby?lat=41.0&lng=29.0&entity_type=site&limit=2' +
        (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
      const page = (await (await get(url, keyA)).json()) as {
        results: Array<{ entity_id: string }>;
        next_cursor: string | null;
      };
      seen.push(...page.results.map((r) => r.entity_id));
      cursor = page.next_cursor;
    } while (cursor !== null);

    expect(seen).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});

describe('geofences', () => {
  it('stores a polygon and reports the entities covering a point', async () => {
    await putGeofence(keyA, 100, polygonBody('r1', squarePolygon(29.0, 41.0)));

    const res = await get('/api/v1/geofences/containing?lat=41.0&lng=29.0&entity_type=site', keyA);
    expect(await res.json()).toEqual({ results: [{ entity_id: 'r1' }] });
  });

  it('answers the single-entity form with an inside flag', async () => {
    await putGeofence(keyA, 101, polygonBody('r1', squarePolygon(29.0, 41.0)));

    const inside = await get(
      '/api/v1/geofences/containing?lat=41.0&lng=29.0&entity_type=site&entity_id=r1',
      keyA,
    );
    expect(await inside.json()).toEqual({ inside: true });

    const outside = await get(
      '/api/v1/geofences/containing?lat=42.0&lng=29.0&entity_type=site&entity_id=r1',
      keyA,
    );
    expect(await outside.json()).toEqual({ inside: false });
  });

  it('rejects a non-polygon geometry', async () => {
    const res = await putGeofence(
      keyA,
      102,
      polygonBody('r1', { type: 'Point', coordinates: [29.0, 41.0] }),
    );
    expect(res.status).toBe(400);
  });

  it('deletes only within the calling tenant', async () => {
    await putGeofence(keyA, 103, polygonBody('r1', squarePolygon(29.0, 41.0)));

    const foreign = await fetch(`${server.baseUrl}/api/v1/geofences/103`, {
      method: 'DELETE',
      headers: { 'x-api-key': keyB },
    });
    expect(foreign.status).toBe(404);

    const own = await fetch(`${server.baseUrl}/api/v1/geofences/103`, {
      method: 'DELETE',
      headers: { 'x-api-key': keyA },
    });
    expect(own.status).toBe(204);
  });

  it('treats a point on a shared edge as covered by both neighbours', async () => {
    const west = ring([28.9, 40.9], [29.0, 40.9], [29.0, 41.1], [28.9, 41.1]);
    const east = ring([29.0, 40.9], [29.1, 40.9], [29.1, 41.1], [29.0, 41.1]);

    await putGeofence(keyA, 201, polygonBody('west', west));
    await putGeofence(keyA, 202, polygonBody('east', east));

    const res = await get('/api/v1/geofences/containing?lat=41.0&lng=29.0&entity_type=site', keyA);
    const { results } = (await res.json()) as { results: Array<{ entity_id: string }> };
    expect(results.map((r) => r.entity_id).sort()).toEqual(['east', 'west']);
  });
});

describe('routing', () => {
  it('answers 503 while OSRM is not configured', async () => {
    const res = await send(
      'POST',
      '/api/v1/routing/distances',
      {
        origin: { lat: 41.0, lng: 29.0 },
        destinations: [{ entity_id: 'r1', entity_type: 'site' }],
      },
      { 'x-api-key': keyA },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 503, title: 'Routing is not configured' });
  });
});

function ring(...corners: Array<[number, number]>) {
  return { type: 'Polygon', coordinates: [[...corners, corners[0]]] };
}
