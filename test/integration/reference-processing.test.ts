import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { adminPoolConfig } from '../helpers/env.js';

/**
 * Drives scripts/datasets/process.sql against real PostGIS with a synthetic map,
 * drawn in kilometres on EPSG:3035 around a point on the Bosphorus.
 */

const ORIGIN_X = 5_907_571;
const ORIGIN_Y = 2_189_750;

type Ring = Array<[number, number]>;

function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

function polygonWkt(ring: Ring): string {
  const points = ring.map(([x, y]) => `${x * 1000} ${y * 1000}`).join(', ');
  return `POLYGON((${points}))`;
}

/** A local shape in WGS84, which is what the importer stores. */
function local(wkt: string): string {
  return `ST_Transform(ST_Translate(ST_GeomFromText('${wkt}', 3035), ${ORIGIN_X}, ${ORIGIN_Y}), 4326)`;
}

function localPoint(x: number, y: number): string {
  return local(`POINT(${x * 1000} ${y * 1000})`);
}

function localRect(x0: number, y0: number, x1: number, y1: number): string {
  return local(polygonWkt(rect(x0, y0, x1, y1)));
}

/** A 5 m zigzag every 100 m: noise that a ~50 m simplification must remove from both sides. */
function zigzag(x: number, y0: number, y1: number): Ring {
  const steps = Math.round((y1 - y0) * 10);
  return Array.from({ length: steps + 1 }, (_, i): [number, number] => [
    i % 2 === 0 ? x : x + 0.005,
    y0 + i * 0.1,
  ]);
}

interface Boundary {
  osmType?: 'relation' | 'way';
  osmId: number;
  level: 4 | 6;
  name: string;
  iso?: string;
  ring: Ring;
}

let admin: pg.Pool;
let processSql: string;

beforeAll(async () => {
  admin = new pg.Pool(adminPoolConfig);
  processSql = await readFile('scripts/datasets/process.sql', 'utf8');
});

afterAll(async () => {
  await admin?.end();
});

beforeEach(async () => {
  await admin.query('TRUNCATE reference.osm_boundaries, reference.osm_places');
});

async function insertBoundaries(boundaries: Boundary[]): Promise<void> {
  for (const b of boundaries) {
    await admin.query(
      `INSERT INTO reference.osm_boundaries
         (osm_type, osm_id, admin_level, name, iso3166_2, wikidata, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(${local(polygonWkt(b.ring))}))`,
      [b.osmType ?? 'relation', b.osmId, b.level, b.name, b.iso ?? null, `Q${b.osmId}`],
    );
  }
}

let nextPlaceId = 1;

async function insertPlace(type: string, name: string, x: number, y: number): Promise<void> {
  await admin.query(
    `INSERT INTO reference.osm_places (osm_type, osm_id, type, name, geom)
     VALUES ('node', $1, $2, $3, ${localPoint(x, y)})`,
    [nextPlaceId++, type, name],
  );
}

async function runProcess(): Promise<void> {
  await admin.query(processSql);
}

/** Area in square metres of a district clipped to a local rectangle. */
async function districtAreaWithin(code: string, area: string): Promise<number> {
  const { rows } = await admin.query<{ m2: number }>(
    `SELECT COALESCE(ST_Area(ST_Transform(ST_Intersection(geom, ${area}), 3035)), 0) AS m2
       FROM reference.districts WHERE code = $1`,
    [code],
  );
  if (rows.length === 0) throw new Error(`district ${code} was not produced`);
  return Number(rows[0]?.m2);
}

async function districtsCovering(x: number, y: number): Promise<string[]> {
  const { rows } = await admin.query<{ code: string }>(
    `SELECT code FROM reference.districts WHERE ST_Covers(geom, ${localPoint(x, y)}) ORDER BY code`,
  );
  return rows.map((r) => r.code);
}

describe('reference.slug', () => {
  const cases: Array<[string, string]> = [
    ['Eyüpsultan', 'eyupsultan'],
    ['Şile', 'sile'],
    ['Kâğıthane', 'kagithane'],
    ['Üsküdar', 'uskudar'],
    ['Çekmeköy', 'cekmekoy'],
    ['Beyoğlu', 'beyoglu'],
    ['İnegöl', 'inegol'],
    ['Ağrı', 'agri'],
    ['KIRIKKALE', 'kirikkale'],
    ['Iğdır Merkez', 'igdir-merkez'],
    ['  Nevşehir  Merkez ', 'nevsehir-merkez'],
    ['Hakkâri', 'hakkari'],
  ];

  it.each(cases)('turns %s into %s', async (name, expected) => {
    const { rows } = await admin.query<{ slug: string }>('SELECT reference.slug($1) AS slug', [
      name,
    ]);
    expect(rows[0]?.slug).toBe(expected);
  });
});

describe('district processing', () => {
  // İstanbul spans x 0-20 and Kocaeli x 20-40; land ends at y = 6, the
  // provinces carry their waters to y = 10, and x < 0, y < 0 is another country.
  const provinces: Boundary[] = [
    { osmId: 4001, level: 4, name: 'İstanbul', iso: 'TR-34', ring: rect(0, 0, 20, 10) },
    { osmId: 4002, level: 4, name: 'Kocaeli', iso: 'TR-41', ring: rect(20, 0, 40, 10) },
  ];
  const besiktas: Boundary = {
    osmId: 6001,
    level: 6,
    name: 'Beşiktaş',
    ring: [[0, 0], [10, 0], ...zigzag(10, 0, 6), [0, 6], [0, 0]],
  };
  const sisli: Boundary = {
    osmId: 6002,
    level: 6,
    name: 'Şişli',
    ring: [[10, 0], [20, 0], [20, 6], ...zigzag(10, 0, 6).reverse(), [10, 0]],
  };
  const gebze: Boundary = { osmId: 6003, level: 6, name: 'Gebze', ring: rect(20, 0, 30, 6) };

  beforeEach(async () => {
    await insertBoundaries([...provinces, besiktas, sisli, gebze]);
  });

  it('keeps only district relations, dropping coastline islets and enclosed duplicates', async () => {
    await insertBoundaries([
      { osmType: 'way', osmId: 6900, level: 6, name: 'Islet', ring: rect(2, 7, 2.5, 7.5) },
      { osmId: 6901, level: 6, name: 'Kara Ada', ring: rect(3, 2, 4, 3) },
    ]);
    await runProcess();

    const { rows } = await admin.query<{ code: string; province_code: string }>(
      'SELECT code, province_code FROM reference.districts ORDER BY code',
    );
    expect(rows).toEqual([
      { code: '34-besiktas', province_code: '34' },
      { code: '34-sisli', province_code: '34' },
      { code: '41-gebze', province_code: '41' },
    ]);
    expect(await districtsCovering(3.5, 2.5)).toEqual(['34-besiktas']);
  });

  it('carries the source identifiers through', async () => {
    await runProcess();

    const { rows } = await admin.query(
      `SELECT name, wikidata, osm_relation::int AS osm_relation
         FROM reference.districts WHERE code = '34-besiktas'`,
    );
    expect(rows).toEqual([{ name: 'Beşiktaş', wikidata: 'Q6001', osm_relation: 6001 }]);
  });

  it('simplifies a border once, so adjacent districts still share it exactly', async () => {
    await runProcess();

    const { rows } = await admin.query<{ points: number; shared_m: number }>(
      `SELECT ST_NPoints(a.geom) AS points,
              ST_Length(ST_Transform(
                ST_Intersection(ST_Boundary(a.geom), ST_Boundary(b.geom)), 3035)) AS shared_m
         FROM reference.districts a, reference.districts b
        WHERE a.code = '34-besiktas' AND b.code = '34-sisli'`,
    );
    expect(rows[0]?.points).toBeLessThan(20);
    expect(Number(rows[0]?.shared_m)).toBeGreaterThan(5_900);

    const invalid = await admin.query(
      `SELECT edge FROM (
         SELECT ST_CoverageInvalidEdges(geom) OVER () AS edge FROM reference.districts
       ) edges WHERE edge IS NOT NULL`,
    );
    expect(invalid.rows).toEqual([]);
  });

  it('extends a coastal district about 200 m over the sea', async () => {
    await runProcess();

    expect(await districtsCovering(5, 6.15)).toEqual(['34-besiktas']);
    expect(await districtsCovering(5, 6.25)).toEqual([]);

    const seaArea = await districtAreaWithin('34-besiktas', localRect(-1, 6, 11, 7));
    expect(seaArea).toBeGreaterThan(1_900_000);
    expect(seaArea).toBeLessThan(2_100_000);
  });

  it('does not spread the coastal buffer onto neighbouring land', async () => {
    await runProcess();

    // Probes stay 50 m clear of legitimate edges: reducing precision to 1e-5
    // degrees moves a vertex by up to half a metre.
    expect(await districtAreaWithin('34-besiktas', localRect(10.1, 0, 20, 5.95))).toBeLessThan(1);
    expect(await districtAreaWithin('34-sisli', localRect(0, 0, 9.9, 5.95))).toBeLessThan(1);
    expect(await districtAreaWithin('34-sisli', localRect(20.05, 0, 40, 10))).toBeLessThan(1);
    expect(await districtAreaWithin('41-gebze', localRect(0, 0, 19.95, 10))).toBeLessThan(1);
  });

  it('never extends past its own province, so a national border holds', async () => {
    await runProcess();

    expect(await districtAreaWithin('34-besiktas', localRect(-5, -5, -0.05, 15))).toBeLessThan(1);
    expect(await districtAreaWithin('34-besiktas', localRect(-5, -5, 45, -0.05))).toBeLessThan(1);
  });

  it('draws each province as the union of its processed districts, not its waters', async () => {
    await runProcess();

    const { rows } = await admin.query<{ code: string; iso3166_2: string; diff_m2: number }>(
      `SELECT p.code, p.iso3166_2,
              ST_Area(ST_Transform(ST_SymDifference(p.geom, d.geom), 3035)) AS diff_m2
         FROM reference.provinces p
         JOIN (SELECT province_code, ST_Union(geom) AS geom
                 FROM reference.districts GROUP BY province_code) d
           ON d.province_code = p.code
        ORDER BY p.code`,
    );
    expect(rows.map((r) => [r.code, r.iso3166_2])).toEqual([
      ['34', 'TR-34'],
      ['41', 'TR-41'],
    ]);
    for (const row of rows) expect(Number(row.diff_m2)).toBeLessThan(100);

    const sea = await admin.query(
      `SELECT code FROM reference.provinces WHERE ST_Covers(geom, ${localPoint(5, 8)})`,
    );
    expect(sea.rows).toEqual([]);
  });
});

describe('narrow water', () => {
  // A 300 m channel at y 3.0-3.3: both 200 m buffers reach into it and overlap
  // at y 3.1-3.2. Beyoğlu has the larger OSM id and is inserted last, so only
  // the code can make it the winner.
  beforeEach(async () => {
    await insertBoundaries([
      { osmId: 4001, level: 4, name: 'İstanbul', iso: 'TR-34', ring: rect(0, 0, 10, 10) },
      { osmId: 6101, level: 6, name: 'Fatih', ring: rect(0, 0, 10, 3) },
      { osmId: 6102, level: 6, name: 'Beyoğlu', ring: rect(0, 3.3, 10, 6) },
    ]);
    await runProcess();
  });

  it('gives the overlap of two buffers to the smaller code', async () => {
    expect(await districtsCovering(5, 3.05)).toEqual(['34-fatih']);
    expect(await districtsCovering(5, 3.15)).toEqual(['34-beyoglu']);
    expect(await districtsCovering(5, 3.25)).toEqual(['34-beyoglu']);
  });
});

describe('place processing', () => {
  beforeEach(async () => {
    await insertBoundaries([
      { osmId: 4001, level: 4, name: 'İstanbul', iso: 'TR-34', ring: rect(0, 0, 20, 10) },
      { osmId: 4002, level: 4, name: 'Kocaeli', iso: 'TR-41', ring: rect(20, 0, 40, 10) },
      { osmId: 6001, level: 6, name: 'Beşiktaş', ring: rect(0, 0, 20, 6) },
      { osmId: 6003, level: 6, name: 'Gebze', ring: rect(20, 0, 40, 6) },
    ]);
  });

  it('assigns a province from the OSM province area, which includes its waters', async () => {
    await insertPlace('port', 'Pier Head', 5, 8);
    await insertPlace('station', 'Gebze Otogarı', 25, 3);
    await runProcess();

    const { rows } = await admin.query(
      'SELECT name, type, province_code FROM reference.places ORDER BY name',
    );
    expect(rows).toEqual([
      { name: 'Gebze Otogarı', type: 'station', province_code: '41' },
      { name: 'Pier Head', type: 'port', province_code: '34' },
    ]);
  });
});
