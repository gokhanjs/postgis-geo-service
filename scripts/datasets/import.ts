import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type pg from 'pg';
import ports from './ports.json' with { type: 'json' };

const run = promisify(execFile);

export const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

export interface Sources {
  osm: { url: string | null; file: string; timestamp: string | null; downloaded_at: string };
  airports: { url: string; downloaded_at: string };
}

interface Feature {
  type: 'Feature';
  geometry: { type: string } | null;
  properties: Record<string, unknown>;
}

const BATCH = 500;

/**
 * Loads the raw rows process.sql works from. Boundaries and bus stations come
 * from one tag filter of the extract, ports from the ids in ports.json.
 */
export async function importSources(
  client: pg.Client,
  options: {
    pbf: string;
    work: string;
    sourceUrl: string | null;
    airportsUrl: string;
    airportsFile: string | null;
  },
): Promise<Sources> {
  const { pbf, work } = options;
  await client.query('TRUNCATE reference.osm_boundaries, reference.osm_places, reference.airports');

  const filtered = join(work, 'filtered.osm.pbf');
  await osmium(
    'tags-filter',
    pbf,
    'r/boundary=administrative',
    'nwr/amenity=bus_station',
    '-o',
    filtered,
    '-O',
  );
  await loadFeatures(
    client,
    await exportSeq(filtered, join(work, 'filtered.geojsonseq')),
    'filtered',
  );

  const portIds = ports.map((p) => p.osm);
  const portsPbf = join(work, 'ports.osm.pbf');
  await osmium('getid', '-r', pbf, ...portIds, '-o', portsPbf, '-O');
  await loadFeatures(client, await exportSeq(portsPbf, join(work, 'ports.geojsonseq')), 'ports');

  const airportsDownloadedAt =
    options.airportsFile === null
      ? new Date().toISOString()
      : (await stat(options.airportsFile)).mtime.toISOString();
  await loadAirports(
    client,
    options.airportsFile === null
      ? await fetchText(options.airportsUrl)
      : await readFile(options.airportsFile, 'utf8'),
  );

  const { stdout } = await osmium(
    'fileinfo',
    '-g',
    'header.option.osmosis_replication_timestamp',
    pbf,
  );
  return {
    osm: {
      url: options.sourceUrl,
      file: pbf.split('/').at(-1) ?? pbf,
      timestamp: stdout.trim() || null,
      downloaded_at: (await stat(pbf)).mtime.toISOString(),
    },
    airports: { url: options.airportsUrl, downloaded_at: airportsDownloadedAt },
  };
}

async function osmium(...args: string[]): Promise<{ stdout: string }> {
  return run('osmium', args, { maxBuffer: 16 * 1024 * 1024 });
}

async function exportSeq(input: string, output: string): Promise<string> {
  await osmium(
    'export',
    input,
    '-f',
    'geojsonseq',
    '-o',
    output,
    '-O',
    '--geometry-types=point,linestring,polygon',
    '--attributes=type,id',
  );
  return output;
}

// RFC 8142: every GeoJSON text sequence record starts with this character.
const RECORD_SEPARATOR = '\u001e';

async function* features(path: string): AsyncGenerator<Feature> {
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = (raw.startsWith(RECORD_SEPARATOR) ? raw.slice(1) : raw).trim();
    if (line !== '') yield JSON.parse(line) as Feature;
  }
}

/** Folds Turkish letters so the name rule needs no case- or locale-aware regex. */
function fold(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(
      /[çğöşüâîû]/g,
      (c) => ({ ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c] ?? c,
    );
}

// amenity=bus_station alone also tags city stops and minibus ranks; operators'
// offices carry the word "turizm".
const INTERCITY = /otogar|terminal|sehir ?ler ?arasi/;
const OPERATOR = /turizm/;

export function isIntercityStation(name: string): boolean {
  const folded = fold(name);
  return INTERCITY.test(folded) && !OPERATOR.test(folded);
}

type BoundaryRow = [string, number, number, string, string | null, string | null, string];
type PlaceRow = [string, number, string, string, string];

async function loadFeatures(client: pg.Client, path: string, source: 'filtered' | 'ports') {
  const boundaries: BoundaryRow[] = [];
  const places: PlaceRow[] = [];
  const named = new Map(ports.map((p) => [p.osm, p.name]));

  for await (const f of features(path)) {
    const p = f.properties;
    const osmType = String(p['@type']);
    const osmId = Number(p['@id']);
    if (f.geometry === null || !Number.isSafeInteger(osmId)) continue;
    const geometry = JSON.stringify(f.geometry);
    const name = typeof p['name'] === 'string' ? p['name'] : null;

    if (source === 'ports') {
      // The list is curated, so its names are too; OSM often names only the pier.
      const curated = named.get(`${osmType[0]}${osmId}`);
      if (curated !== undefined) places.push([osmType, osmId, 'port', curated, geometry]);
    } else if (p['boundary'] === 'administrative' && /^Multi|^Polygon/.test(f.geometry.type)) {
      const level = Number(p['admin_level']);
      if ((level === 4 || level === 6) && name !== null) {
        const iso = typeof p['ISO3166-2'] === 'string' ? p['ISO3166-2'] : null;
        const wikidata = typeof p['wikidata'] === 'string' ? p['wikidata'] : null;
        boundaries.push([osmType, osmId, level, name, iso, wikidata, geometry]);
      }
    } else if (p['amenity'] === 'bus_station' && name !== null && isIntercityStation(name)) {
      places.push([osmType, osmId, 'station', name, geometry]);
    }

    if (boundaries.length >= BATCH) await insertBoundaries(client, boundaries.splice(0));
    if (places.length >= BATCH) await insertPlaces(client, places.splice(0));
  }
  await insertBoundaries(client, boundaries);
  await insertPlaces(client, places);
}

// osmium export writes a closed way once as a line and once as an area, so a
// repeated (type, id) is expected and skipped.
async function insertBoundaries(client: pg.Client, rows: BoundaryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO reference.osm_boundaries
       (osm_type, osm_id, admin_level, name, iso3166_2, wikidata, geom)
     SELECT r->>0, (r->>1)::bigint, (r->>2)::smallint, r->>3, r->>4, r->>5,
            ST_Multi(ST_CollectionExtract(ST_MakeValid(
              ST_SetSRID(ST_GeomFromGeoJSON(r->>6), 4326)), 3))
       FROM jsonb_array_elements($1::jsonb) r
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(rows)],
  );
}

async function insertPlaces(client: pg.Client, rows: PlaceRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO reference.osm_places (osm_type, osm_id, type, name, geom)
     SELECT r->>0, (r->>1)::bigint, r->>2, r->>3,
            ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(r->>4), 4326))
       FROM jsonb_array_elements($1::jsonb) r
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(rows)],
  );
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`downloading ${url} answered ${res.status}`);
  return res.text();
}

/** RFC 4180 fields: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** Turkish airports with scheduled service; the ident is the ICAO code for all of them. */
async function loadAirports(client: pg.Client, csv: string): Promise<void> {
  const [header, ...records] = parseCsv(csv);
  if (header === undefined) throw new Error('airports.csv is empty');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`airports.csv has no ${name} column`);
    return index;
  };
  const at = {
    ident: column('ident'),
    name: column('name'),
    lat: column('latitude_deg'),
    lng: column('longitude_deg'),
    country: column('iso_country'),
    region: column('iso_region'),
    scheduled: column('scheduled_service'),
    iata: column('iata_code'),
    icao: column('icao_code'),
  };

  const rows = records
    .filter((r) => r[at.country] === 'TR' && r[at.scheduled] === 'yes')
    .map((r) => ({
      ident: r[at.ident],
      name: r[at.name],
      iata: r[at.iata] || null,
      icao: r[at.icao] || null,
      iso_region: r[at.region] || null,
      lat: Number(r[at.lat]),
      lng: Number(r[at.lng]),
    }));

  await client.query(
    `INSERT INTO reference.airports (ident, iata, icao, name, iso_region, geom)
     SELECT ident, iata, icao, name, iso_region, ST_Point(lng, lat, 4326)
       FROM jsonb_to_recordset($1::jsonb)
         AS r(ident text, iata text, icao text, name text, iso_region text, lat float8, lng float8)`,
    [JSON.stringify(rows)],
  );
}
