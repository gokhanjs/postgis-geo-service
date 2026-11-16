import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import type { ReleaseSummary } from './gate.ts';
import type { Sources } from './import.ts';
import { ADMIN, PLACES } from './validate.ts';

const LICENSE = 'ODbL-1.0';
const ATTRIBUTION = '© OpenStreetMap contributors';

const OSM_NOTICE = `This package contains data from OpenStreetMap, ${ATTRIBUTION}.
It is a Derivative Database of OpenStreetMap and is made available under the
Open Database License 1.0: https://opendatacommons.org/licenses/odbl/1-0/
Copyright and licence details: https://www.openstreetmap.org/copyright
`;

const AIRPORTS_NOTICE = `
Airport records come from OurAirports (https://ourairports.com/data/), whose
data is dedicated to the public domain under the Unlicense.
`;

interface PackageFile {
  name: string;
  body: string;
  features?: number;
}

export interface ReleaseInput {
  root: string;
  version: string;
  generatedAt: string;
  sources: Sources;
  summary: ReleaseSummary;
}

export function stagingDir(root: string, name: string, version: string): string {
  return join(root, name, `.staging-${version}`);
}

/** Writes both packages into staging directories, which publish.ts then moves into place. */
export async function exportRelease(client: pg.Client, input: ReleaseInput): Promise<void> {
  const provinces = await featureCollection(
    client,
    `SELECT json_build_object('code', code, 'name', name, 'iso3166_2', iso3166_2) AS properties,
            ST_AsGeoJSON(geom, 5)::json AS geometry
       FROM reference.provinces ORDER BY code`,
  );
  const admin: PackageFile[] = [{ name: 'provinces.geojson', ...provinces }];

  const { rows } = await client.query<{ code: string }>(
    'SELECT code FROM reference.provinces ORDER BY code',
  );
  for (const { code } of rows) {
    const districts = await featureCollection(
      client,
      `SELECT json_build_object('code', code, 'name', name, 'province_code', province_code,
                                'wikidata', wikidata, 'osm_relation', osm_relation) AS properties,
              ST_AsGeoJSON(geom, 5)::json AS geometry
         FROM reference.districts WHERE province_code = $1 ORDER BY code`,
      [code],
    );
    admin.push({ name: `tr-${code}-districts.geojson`, ...districts });
  }

  const places = await featureCollection(
    client,
    `SELECT json_build_object('code', code, 'type', type, 'name', name, 'iata', iata,
                              'icao', icao, 'lat', round(ST_Y(geom)::numeric, 5),
                              'lng', round(ST_X(geom)::numeric, 5),
                              'province_code', province_code) AS properties,
            ST_AsGeoJSON(geom, 5)::json AS geometry
       FROM reference.places ORDER BY code`,
  );

  const { summary, sources } = input;
  await writePackage(input, ADMIN, [osm(sources)], OSM_NOTICE, admin, {
    provinces: summary.provinces,
    districts: summary.districts,
  });
  await writePackage(
    input,
    PLACES,
    [osm(sources), { name: 'OurAirports', license: 'Unlicense', ...sources.airports }],
    OSM_NOTICE + AIRPORTS_NOTICE,
    [{ name: 'places.geojson', ...places }],
    { places: summary.places },
  );
}

function osm(sources: Sources) {
  return { name: 'OpenStreetMap', license: LICENSE, attribution: ATTRIBUTION, ...sources.osm };
}

async function featureCollection(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ body: string; features: number }> {
  const { rows } = await client.query<{ properties: unknown; geometry: unknown }>(sql, params);
  const features = rows.map((r) => ({
    type: 'Feature',
    properties: r.properties,
    geometry: r.geometry,
  }));
  return {
    body: `${JSON.stringify({ type: 'FeatureCollection', features })}\n`,
    features: features.length,
  };
}

async function writePackage(
  input: ReleaseInput,
  name: string,
  sources: unknown[],
  notice: string,
  files: PackageFile[],
  summary: Partial<ReleaseSummary>,
): Promise<void> {
  const dir = stagingDir(input.root, name, input.version);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const listed = [...files, { name: 'NOTICE', body: notice }];
  for (const file of listed) await writeFile(join(dir, file.name), file.body);

  const manifest = {
    name,
    version: input.version,
    generated_at: input.generatedAt,
    license: LICENSE,
    attribution: ATTRIBUTION,
    sources,
    files: listed.map((f) => ({
      name: f.name,
      sha256: createHash('sha256').update(f.body).digest('hex'),
      bytes: Buffer.byteLength(f.body),
      ...(f.features === undefined ? {} : { features: f.features }),
    })),
  };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Not in the manifest, so never served: the gate compares the next release against it.
  await writeFile(join(dir, 'summary.json'), JSON.stringify(summary));
}
