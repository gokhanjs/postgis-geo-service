import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { createApiKey, resetDatabase } from '../helpers/fixtures.js';

type StubAnswer = { status: number; body: unknown; delayMs?: number } | 'drop';

/** Stands in for OSRM's transport and status codes; the real engine is exercised below. */
class OsrmStub {
  readonly paths: string[] = [];
  answer: StubAnswer | ((path: string) => StubAnswer) = {
    status: 200,
    body: okRoute(1000, 60, 'osm-2026-11-14'),
  };
  #server: Server | undefined;

  async start(): Promise<string> {
    this.#server = createServer((req, res) => {
      const path = req.url ?? '';
      this.paths.push(path);
      const answer = typeof this.answer === 'function' ? this.answer(path) : this.answer;
      if (answer === 'drop') {
        req.socket.destroy();
        return;
      }
      setTimeout(() => {
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      }, answer.delayMs ?? 0);
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.#server?.closeAllConnections();
    await new Promise((resolve) => this.#server?.close(resolve));
  }
}

function okRoute(metres: number, seconds: number, dataVersion?: string) {
  return {
    code: 'Ok',
    routes: [{ distance: metres, duration: seconds }],
    waypoints: [],
    ...(dataVersion === undefined ? {} : { data_version: dataVersion }),
  };
}

const IST_AIRPORT = { lat: 41.2753, lng: 28.7519 };
const SILIVRI = { lat: 41.0739, lng: 28.2464 };

let stub: OsrmStub;
let routed: TestServer;
let unrouted: TestServer;
let key: string;

beforeAll(async () => {
  stub = new OsrmStub();
  const osrmUrl = await stub.start();
  routed = await startTestServer({ OSRM_URL: osrmUrl });
  unrouted = await startTestServer({ OSRM_URL: '' });
});

afterAll(async () => {
  await routed?.stop();
  await unrouted?.stop();
  await stub?.stop();
});

beforeEach(async () => {
  await resetDatabase(routed.pool);
  key = await createApiKey(routed.pool, 1, 'routing-client');
  stub.paths.length = 0;
  stub.answer = { status: 200, body: okRoute(1000, 60, 'osm-2026-11-14') };
});

function route(server: TestServer, body: unknown, apiKey: string | null = key) {
  return fetch(`${server.baseUrl}/api/v1/routing/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    body: JSON.stringify(body),
  });
}

function pair(lat: number, lng: number) {
  return { origin: { lat, lng }, destination: { lat: lat + 0.05, lng: lng + 0.05 } };
}

describe('POST /api/v1/routing/route', () => {
  it('answers road distance, duration and the data version', async () => {
    stub.answer = { status: 200, body: okRoute(58_400, 3_120, 'osm-2026-11-14') };

    const res = await route(routed, { origin: IST_AIRPORT, destination: SILIVRI });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      road_distance_km: 58.4,
      duration_min: 52,
      data_version: 'osm-2026-11-14',
    });
    expect(stub.paths).toEqual([
      '/route/v1/driving/28.7519,41.2753;28.2464,41.0739?overview=false&radiuses=1000;1000',
    ]);
  });

  it('answers 503 routing-disabled while OSRM is not configured', async () => {
    const res = await route(unrouted, pair(41.01, 29.01), await createApiKey(unrouted.pool, 1));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      type: 'urn:geo-service:problem:routing-disabled',
      status: 503,
    });
  });

  it('answers 503 routing-unreachable when OSRM drops the connection', async () => {
    stub.answer = 'drop';

    const res = await route(routed, pair(41.02, 29.02));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      type: 'urn:geo-service:problem:routing-unreachable',
      status: 503,
    });
    expect(stub.paths).toHaveLength(2);
  });

  it('answers 503 routing-unreachable when OSRM fails with a server error', async () => {
    stub.answer = { status: 500, body: { code: 'InternalError' } };

    const res = await route(routed, pair(41.08, 29.08));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      type: 'urn:geo-service:problem:routing-unreachable',
    });
  });

  it('answers a null data version when OSRM was built without one', async () => {
    stub.answer = { status: 200, body: okRoute(1000, 60) };

    const res = await route(routed, pair(41.09, 29.09));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data_version: null });
  });

  it('answers 422 route-not-found when OSRM finds no road between the points', async () => {
    stub.answer = {
      status: 400,
      body: { code: 'NoRoute', message: 'Impossible route between points' },
    };

    const res = await route(routed, pair(41.03, 29.03));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      type: 'urn:geo-service:problem:route-not-found',
      status: 422,
    });
  });

  it('answers 422 point-not-routable when a point has no road within reach', async () => {
    stub.answer = {
      status: 400,
      body: { code: 'NoSegment', message: 'Could not find a matching segment for coordinate 1' },
    };

    const res = await route(routed, pair(41.13, 29.13));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      type: 'urn:geo-service:problem:point-not-routable',
      status: 422,
    });
  });

  it('serves a repeated pair from the cache, including one that differs below a metre', async () => {
    const first = await route(routed, pair(41.04, 29.04));
    const again = await route(routed, pair(41.04, 29.04));
    const nudged = await route(routed, pair(41.040001, 29.040001));

    expect([first.status, again.status, nudged.status]).toEqual([200, 200, 200]);
    expect(await nudged.json()).toEqual(await first.json());
    expect(stub.paths).toHaveLength(1);
  });

  it('drops cached answers once OSRM reports a newer data version', async () => {
    stub.answer = { status: 200, body: okRoute(1000, 60, 'osm-2026-11-14') };
    await route(routed, pair(41.05, 29.05));

    stub.answer = { status: 200, body: okRoute(2000, 120, 'osm-2026-11-21') };
    await route(routed, pair(41.06, 29.06));
    const refreshed = await route(routed, pair(41.05, 29.05));

    expect(stub.paths).toHaveLength(3);
    expect(await refreshed.json()).toMatchObject({ data_version: 'osm-2026-11-21' });
  });

  it('asks OSRM once for a pair requested concurrently', async () => {
    stub.answer = { status: 200, body: okRoute(1000, 60, 'osm-2026-11-14'), delayMs: 200 };

    const answers = await Promise.all([1, 2, 3].map(() => route(routed, pair(41.1, 29.1))));

    expect(answers.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(stub.paths).toHaveLength(1);
  });

  it('keeps the newer data version when a slower answer from the old map lands last', async () => {
    const slowOldMap = pair(41.11, 29.11);
    const fastNewMap = pair(41.12, 29.12);
    stub.answer = (path) =>
      path.includes('29.11')
        ? { status: 200, body: okRoute(1000, 60, 'osm-2026-11-14'), delayMs: 300 }
        : { status: 200, body: okRoute(2000, 120, 'osm-2026-11-21') };

    const slow = route(routed, slowOldMap);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route(routed, fastNewMap);
    await slow;
    await route(routed, fastNewMap);
    await route(routed, slowOldMap);

    expect(stub.paths).toHaveLength(3);
  });

  it('rejects a coordinate out of range with 400', async () => {
    const res = await route(routed, { origin: { lat: 91, lng: 29 }, destination: SILIVRI });

    expect(res.status).toBe(400);
    expect(stub.paths).toHaveLength(0);
  });

  it('answers 401 without an API key', async () => {
    const res = await route(routed, pair(41.07, 29.07), null);

    expect(res.status).toBe(401);
    expect(stub.paths).toHaveLength(0);
  });
});

describe.skipIf(!process.env.OSRM_URL)('POST /api/v1/routing/route against OSRM', () => {
  let real: TestServer;

  beforeAll(async () => {
    real = await startTestServer({ OSRM_URL: process.env.OSRM_URL as string });
  });

  afterAll(async () => {
    await real?.stop();
  });

  it('measures a road distance longer than the straight line', async () => {
    const casino = { lat: 43.7393, lng: 7.4284 };
    const stadium = { lat: 43.7276, lng: 7.4156 };

    const res = await route(
      real,
      { origin: casino, destination: stadium },
      await createApiKey(real.pool, 1),
    );
    const body = (await res.json()) as {
      road_distance_km: number;
      duration_min: number;
      data_version: string | null;
    };

    expect(res.status).toBe(200);
    expect(body.road_distance_km).toBeGreaterThan(haversineKm(casino, stadium));
    expect(body.road_distance_km).toBeLessThan(haversineKm(casino, stadium) * 4);
    expect(body.duration_min).toBeGreaterThan(0);
    expect(body.data_version).toMatch(/^osm-\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a point far from any road instead of snapping it there', async () => {
    const casino = { lat: 43.7393, lng: 7.4284 };
    const openSea = { lat: 43.6, lng: 7.5 };

    const res = await route(
      real,
      { origin: casino, destination: openSea },
      await createApiKey(real.pool, 1),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ type: 'urn:geo-service:problem:point-not-routable' });
  });
});

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
