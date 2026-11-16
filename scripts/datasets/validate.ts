import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import type { ReleaseSummary } from './gate.ts';
import ports from './ports.json' with { type: 'json' };

export const ADMIN = 'tr-admin';
export const PLACES = 'tr-places';

export async function summarize(client: pg.Client): Promise<ReleaseSummary> {
  const provinces = await client.query<{ code: string; iso3166_2: string }>(
    'SELECT code, iso3166_2 FROM reference.provinces ORDER BY code',
  );
  const districts = await client.query<{ code: string; province_code: string; area_m2: number }>(
    `SELECT code, province_code, round(ST_Area(geom::geography))::float8 AS area_m2
       FROM reference.districts ORDER BY code`,
  );
  const places = await client.query<{ code: string; type: string; iata: string | null }>(
    'SELECT code, type, iata FROM reference.places ORDER BY code',
  );
  return { provinces: provinces.rows, districts: districts.rows, places: places.rows };
}

/** The checks that need the geometries themselves rather than the summary. */
export async function checkGeometry(client: pg.Client): Promise<string[]> {
  const failures: string[] = [];

  const invalid = await client.query<{ code: string }>(
    `SELECT code FROM reference.districts WHERE NOT ST_IsValid(geom)
     UNION ALL SELECT code FROM reference.provinces WHERE NOT ST_IsValid(geom) ORDER BY 1`,
  );
  if (invalid.rows.length > 0) {
    failures.push(`invalid geometry: ${invalid.rows.map((r) => r.code).join(', ')}`);
  }

  const edges = await client.query<{ code: string }>(
    `SELECT code FROM (
       SELECT code, ST_CoverageInvalidEdges(geom) OVER () AS edge FROM reference.districts
     ) e WHERE edge IS NOT NULL ORDER BY code`,
  );
  if (edges.rows.length > 0) {
    failures.push(
      `districts not forming a clean coverage: ${edges.rows.map((r) => r.code).join(', ')}`,
    );
  }

  // OurAirports records the region independently, so a disagreement means one source is wrong.
  const misplaced = await client.query<{ code: string }>(
    `SELECT p.code FROM reference.places p JOIN reference.airports a ON p.code = 'airport:' || a.ident
      WHERE a.iso_region IS DISTINCT FROM 'TR-' || p.province_code ORDER BY p.code`,
  );
  if (misplaced.rows.length > 0) {
    failures.push(
      `airports whose region disagrees: ${misplaced.rows.map((r) => r.code).join(', ')}`,
    );
  }

  // A scheduled airport is in Turkey by definition; one outside every province was mis-geocoded.
  const unplaced = await client.query<{ ident: string }>(
    `SELECT ident FROM reference.airports a
      WHERE NOT EXISTS (SELECT FROM reference.places p WHERE p.code = 'airport:' || a.ident)
      ORDER BY ident`,
  );
  if (unplaced.rows.length > 0) {
    failures.push(
      `airports outside every province: ${unplaced.rows.map((r) => r.ident).join(', ')}`,
    );
  }

  const found = await client.query<{ id: string }>(
    `SELECT left(osm_type, 1) || osm_id AS id FROM reference.osm_places WHERE type = 'port'`,
  );
  const present = new Set(found.rows.map((r) => r.id));
  const gone = ports.map((p) => p.osm).filter((id) => !present.has(id));
  if (gone.length > 0) failures.push(`ports.json ids no longer in the extract: ${gone.join(', ')}`);

  return failures;
}

/** The summaries the latest published versions were gated on, or null before the first release. */
export async function previousSummary(root: string): Promise<ReleaseSummary | null> {
  const admin = await latestSummary(root, ADMIN);
  const places = await latestSummary(root, PLACES);
  if (admin === null && places === null) return null;
  return {
    provinces: admin?.provinces ?? [],
    districts: admin?.districts ?? [],
    places: places?.places ?? [],
  };
}

async function latestSummary(root: string, name: string): Promise<Partial<ReleaseSummary> | null> {
  const index = await readJson<{ latest: string }>(join(root, name, 'index.json'));
  if (index === null) return null;
  const summary = await readJson<Partial<ReleaseSummary>>(
    join(root, name, index.latest, 'summary.json'),
  );
  // Treating a published release as absent would let the next one skip the comparison.
  if (summary === null)
    throw new Error(`${name} ${index.latest} has no summary.json to gate against`);
  return summary;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return null;
    throw err;
  }
}
