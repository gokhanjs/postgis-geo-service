import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { createApiKey, resetDatabase } from '../helpers/fixtures.js';

interface PackageFile {
  name: string;
  body: string;
}

const NOTICE = 'Contains data © OpenStreetMap contributors, available under ODbL 1.0.\n';
const PROVINCES = JSON.stringify({ type: 'FeatureCollection', features: [] });
const DISTRICTS = JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { code: '34-fatih' }, geometry: null }],
});

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

let root: string;
let server: TestServer;
let key: string;
const manifests = new Map<string, unknown>();

/** Writes one version the way the publisher does, plus anything placed beside it. */
async function writeVersion(
  name: string,
  version: string,
  files: PackageFile[],
  strays: PackageFile[] = [],
  missing: PackageFile[] = [],
): Promise<void> {
  const dir = join(root, name, version);
  await mkdir(dir, { recursive: true });
  for (const file of [...files, ...strays]) await writeFile(join(dir, file.name), file.body);
  files = [...files, ...missing];

  const manifest = {
    name,
    version,
    generated_at: `${version}T04:00:00Z`,
    license: 'ODbL-1.0',
    files: files.map((f) => ({
      name: f.name,
      sha256: sha256(f.body),
      bytes: Buffer.byteLength(f.body),
    })),
  };
  manifests.set(`${name}/${version}`, manifest);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
}

async function writeIndex(name: string, latest: string, versions: string[]): Promise<void> {
  await writeFile(join(root, name, 'index.json'), JSON.stringify({ latest, versions }));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'datasets-'));

  await writeVersion('tr-admin', '2026-10-05', [
    { name: 'provinces.geojson', body: PROVINCES },
    { name: 'NOTICE', body: NOTICE },
  ]);
  await writeVersion(
    'tr-admin',
    '2026-11-02',
    [
      { name: 'provinces.geojson', body: PROVINCES },
      { name: 'tr-34-districts.geojson', body: DISTRICTS },
      { name: 'NOTICE', body: NOTICE },
    ],
    [{ name: 'unlisted.txt', body: 'not part of the package' }],
    [{ name: 'pruned.geojson', body: PROVINCES }],
  );
  // On disk but absent from the index: a version still being written, or one pruned.
  await writeVersion('tr-admin', '2026-12-07', [{ name: 'NOTICE', body: NOTICE }]);
  await writeIndex('tr-admin', '2026-11-02', ['2026-11-02', '2026-10-05']);

  await writeVersion('tr-places', '2026-11-02', [
    { name: 'places.geojson', body: PROVINCES },
    { name: 'NOTICE', body: NOTICE },
  ]);
  await writeIndex('tr-places', '2026-11-02', ['2026-11-02']);

  await writeFile(join(root, 'secret.txt'), 'outside every package');
  await mkdir(join(root, 'tr-broken'));
  await writeFile(join(root, 'tr-broken', 'index.json'), '{"latest": "2026-11');

  server = await startTestServer({ DATASETS_DIR: root });
});

afterAll(async () => {
  await server?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(server.pool);
  key = await createApiKey(server.pool, 1, 'dataset-reader');
});

function get(path: string, headers: Record<string, string> = {}, apiKey: string | null = key) {
  return fetch(`${server.baseUrl}/api/v1/datasets${path}`, {
    headers: { ...(apiKey === null ? {} : { 'x-api-key': apiKey }), ...headers },
  });
}

async function expectNotFound(path: string): Promise<void> {
  const res = await get(path);
  expect(res.status, path).toBe(404);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(await res.json()).toMatchObject({ type: 'urn:geo-service:problem:not-found' });
}

describe('GET /api/v1/datasets', () => {
  it('lists each package with its latest and retained versions', async () => {
    const res = await get('');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      datasets: [
        { name: 'tr-admin', latest: '2026-11-02', versions: ['2026-11-02', '2026-10-05'] },
        { name: 'tr-places', latest: '2026-11-02', versions: ['2026-11-02'] },
      ],
    });
  });
});

describe('GET /api/v1/datasets/{name}/{version}/manifest', () => {
  it('returns the manifest of a named version', async () => {
    const res = await get('/tr-admin/2026-10-05/manifest');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(manifests.get('tr-admin/2026-10-05'));
  });

  it('resolves latest through the index', async () => {
    const res = await get('/tr-admin/latest/manifest');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(manifests.get('tr-admin/2026-11-02'));
  });

  it('answers 404 for an unknown package or version', async () => {
    await expectNotFound('/tr-roads/latest/manifest');
    await expectNotFound('/tr-admin/2025-01-01/manifest');
  });

  it('answers 404 for a version on disk that the index does not list', async () => {
    await expectNotFound('/tr-admin/2026-12-07/manifest');
  });
});

describe('GET /api/v1/datasets/{name}/{version}/files/{file}', () => {
  it('serves a listed file with its digest as the ETag', async () => {
    const res = await get('/tr-admin/2026-11-02/files/tr-34-districts.geojson');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/geo\+json/);
    expect(res.headers.get('etag')).toBe(`"${sha256(DISTRICTS)}"`);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe(DISTRICTS);
  });

  it('serves the notice as plain text', async () => {
    const res = await get('/tr-admin/2026-11-02/files/NOTICE');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe(NOTICE);
  });

  it('does not mark a file reached through latest as immutable', async () => {
    const res = await get('/tr-admin/latest/files/tr-34-districts.geojson');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
    expect(await res.text()).toBe(DISTRICTS);
  });

  it.each([
    `"${sha256(DISTRICTS)}"`,
    `W/"${sha256(DISTRICTS)}"`,
    `"stale", "${sha256(DISTRICTS)}"`,
    '*',
  ])('answers 304 when the client already holds the file (%s)', async (tag) => {
    const res = await get('/tr-admin/2026-11-02/files/tr-34-districts.geojson', {
      'if-none-match': tag,
    });

    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(`"${sha256(DISTRICTS)}"`);
  });

  it('sends the file when the client holds another version', async () => {
    const res = await get('/tr-admin/2026-11-02/files/tr-34-districts.geojson', {
      'if-none-match': '"stale"',
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(DISTRICTS);
  });

  it('answers 404 for a listed file that is no longer on disk', async () => {
    await expectNotFound('/tr-admin/2026-11-02/files/pruned.geojson');
  });

  it('answers 404 for a file the manifest does not list, even when it is on disk', async () => {
    await expectNotFound('/tr-admin/2026-11-02/files/unlisted.txt');
    await expectNotFound('/tr-admin/2026-11-02/files/manifest.json');
    await expectNotFound('/tr-admin/2026-10-05/files/tr-34-districts.geojson');
  });

  it.each([
    '/tr-admin/2026-11-02/files/..%2F..%2Fsecret.txt',
    '/tr-admin/2026-11-02/files/%2e%2e%2f%2e%2e%2fsecret.txt',
    '/..%2Ftr-admin/2026-11-02/manifest',
    '/tr-admin/..%2F2026-11-02/manifest',
    '/tr-admin/2026-11-02/files/%2Fetc%2Fpasswd',
  ])('answers 404 for the path %s', async (path) => {
    await expectNotFound(path);
  });
});

describe('a corrupt package', () => {
  it('is left out of the listing and answers 404 rather than failing the others', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { datasets: Array<{ name: string }> };
    expect(body.datasets.map((d) => d.name)).toEqual(['tr-admin', 'tr-places']);

    await expectNotFound('/tr-broken/latest/manifest');
  });
});

describe('access', () => {
  it.each(['', '/tr-admin/latest/manifest', '/tr-admin/2026-11-02/files/NOTICE'])(
    'answers 401 without an API key at %s',
    async (path) => {
      const res = await get(path, {}, null);
      expect(res.status).toBe(401);
    },
  );
});
