import 'dotenv/config';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { exportRelease } from './export.ts';
import { validateRelease } from './gate.ts';
import { AIRPORTS_URL, importSources } from './import.ts';
import { clearStaging, publish } from './publish.ts';
import { ADMIN, checkGeometry, PLACES, previousSummary, summarize } from './validate.ts';

const USAGE = `usage: update.ts --pbf <extract.osm.pbf> --out <datasets dir>
  [--work <dir>] [--source-url <url of the extract>] [--accept-removed] [--accept-area-change]
  [--airports-url <url>] [--airports-file <airports.csv already downloaded from that url>]`;

const { values } = parseArgs({
  options: {
    pbf: { type: 'string' },
    out: { type: 'string' },
    work: { type: 'string' },
    'source-url': { type: 'string' },
    'airports-url': { type: 'string' },
    'airports-file': { type: 'string' },
    'accept-removed': { type: 'boolean', default: false },
    'accept-area-change': { type: 'boolean', default: false },
  },
});

if (values.pbf === undefined || values.out === undefined) {
  console.error(USAGE);
  process.exit(2);
}

const root = values.out;
const generatedAt = new Date();
const version = generatedAt
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, 'Z');
const work = values.work ?? (await mkdtemp(join(tmpdir(), 'datasets-')));

// The staging schema belongs to the migration role; the service role cannot read it.
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.MIGRATION_DB_USER ?? 'postgres',
  password: process.env.MIGRATION_DB_PASS ?? 'postgres',
  database: process.env.DB_NAME,
});

function step(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

let connected = false;
try {
  await client.connect();
  connected = true;
  await clearStaging(root, ADMIN);
  await clearStaging(root, PLACES);

  step(`importing ${values.pbf}`);
  const sources = await importSources(client, {
    pbf: values.pbf,
    work,
    sourceUrl: values['source-url'] ?? null,
    airportsUrl: values['airports-url'] ?? AIRPORTS_URL,
    airportsFile: values['airports-file'] ?? null,
  });

  step('processing');
  await client.query(await readFile(new URL('./process.sql', import.meta.url), 'utf8'));

  step('validating');
  const summary = await summarize(client);
  const gate = validateRelease(summary, await previousSummary(root), {
    acceptRemoved: values['accept-removed'],
    acceptAreaChange: values['accept-area-change'],
  });
  const failures = [...gate.failures, ...(await checkGeometry(client))];

  // Written whether or not the release passes: a blocked one is what a person reads first.
  const report = {
    version,
    ok: failures.length === 0,
    failures,
    removed: gate.removed,
    added: gate.added,
    area_changed: gate.areaChanged,
  };
  await mkdir(join(root, '.reports'), { recursive: true });
  await writeFile(
    join(root, '.reports', `${version}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`gate: ${failure}`);
    console.log(
      `${version} blocked by ${failures.length} gate failure(s); the previous release stays`,
    );
    process.exitCode = 1;
  } else {
    step('exporting');
    await exportRelease(client, {
      root,
      version,
      generatedAt: generatedAt.toISOString(),
      sources,
      summary,
    });
    await publish(root, PLACES, version);
    await publish(root, ADMIN, version);
    console.log(
      `${version} published: ${summary.provinces.length} provinces, ${summary.districts.length} districts, ` +
        `${summary.places.length} places, ${gate.added.length} added, ${gate.removed.length} removed`,
    );
  }
} finally {
  // The files are the product; rows left here would ride along in every nightly dump.
  if (connected) {
    await client
      .query(
        `TRUNCATE reference.osm_boundaries, reference.osm_places, reference.airports,
                  reference.provinces, reference.districts, reference.places`,
      )
      .catch((err: unknown) =>
        console.error(`clearing the reference tables failed: ${String(err)}`),
      );
  }
  await client.end();
  if (values.work === undefined) await rm(work, { recursive: true, force: true });
}
