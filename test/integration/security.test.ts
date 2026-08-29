import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { ADMIN_TOKEN, createApiKey, resetDatabase, squarePolygon } from '../helpers/fixtures.js';

let server: TestServer;
let apiKey: string;

beforeAll(async () => {
  server = await startTestServer({ RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_MS: '60000' });
});

afterAll(async () => {
  await server?.stop();
});

beforeEach(async () => {
  await resetDatabase(server.pool);
  apiKey = await createApiKey(server.pool, 1, 'tenant-a');
});

describe('credential storage', () => {
  it('never writes a usable credential to the database', async () => {
    const created = await fetch(`${server.baseUrl}/api/v1/admin/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ tenant_id: 9, project_name: 'acme-delivery' }),
    });
    const { key } = (await created.json()) as { key: string };

    // The issued key works, and yet appears nowhere in the table.
    const authorised = await fetch(
      `${server.baseUrl}/api/v1/entities/nearby?lat=41&lng=29&entity_type=restaurant`,
      { headers: { 'x-api-key': key } },
    );
    expect(authorised.status).toBe(200);

    const { rows } = await server.pool.query('SELECT key_hash, key_prefix FROM api_keys');
    const stored = rows.map((r) => JSON.stringify(r)).join(' ');
    expect(stored).not.toContain(key);
    expect(stored).not.toContain(ADMIN_TOKEN);

    const admin = await server.pool.query('SELECT token_hash FROM admin_tokens');
    expect(admin.rows[0]).not.toMatchObject({ token_hash: ADMIN_TOKEN });
  });
});

describe('error responses', () => {
  it('describes failures as RFC 9457 problem details', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/entities/nearby?lat=41&lng=29`, {
      headers: { 'x-api-key': apiKey },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 400, instance: expect.stringContaining('/nearby') });
    expect(typeof body['title']).toBe('string');
  });

  it('answers an unknown route with a problem document, not an HTML page', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: 404, title: 'Route not found' });
  });

  it('returns a correlation id the caller can quote', async () => {
    const res = await fetch(`${server.baseUrl}/health/live`, {
      headers: { 'x-request-id': 'known-value' },
    });
    expect(res.headers.get('x-request-id')).toBe('known-value');
  });
});

describe('rate limiting', () => {
  it('meters each tenant separately rather than each address', async () => {
    const spender = await createApiKey(server.pool, 91, 'quota-spender');
    const otherKey = await createApiKey(server.pool, 92, 'quota-neighbour');
    const url = `${server.baseUrl}/api/v1/entities/nearby?lat=41&lng=29&entity_type=restaurant`;

    // Both share one address, which an address-keyed limiter would conflate.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(url, { headers: { 'x-api-key': spender } });
      statuses.push(res.status);
    }
    // 429, not 500: the limiter's rejection has to survive the error handler.
    expect(statuses).toContain(429);
    expect(statuses).not.toContain(500);

    const other = await fetch(url, { headers: { 'x-api-key': otherKey } });
    expect(other.status).toBe(200);
  });
});

describe('geometry validation', () => {
  it('rejects a ring that does not close', async () => {
    const res = await syncGeofence({
      type: 'Polygon',
      coordinates: [
        [
          [29.0, 41.0],
          [29.1, 41.0],
          [29.1, 41.1],
          [29.0, 41.1],
        ],
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: string };
    expect(body.detail).toContain('closed');
  });

  it('refuses a polygon with an unreasonable number of positions', async () => {
    const ring = Array.from({ length: 10_050 }, (_, i) => [29 + i * 1e-6, 41]);
    ring.push([29, 41]);

    const res = await syncGeofence({ type: 'Polygon', coordinates: [ring] });
    expect(res.status).toBe(400);
  });

  it('accepts a well-formed polygon', async () => {
    const res = await syncGeofence(squarePolygon(29.0, 41.0));
    expect(res.status).toBe(200);
  });
});

function syncGeofence(area: unknown) {
  return fetch(`${server.baseUrl}/api/v1/geofences/1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ entity_id: 'r1', entity_type: 'restaurant', area, is_active: true }),
  });
}
