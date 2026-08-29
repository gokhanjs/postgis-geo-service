import 'dotenv/config';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const OSRM_IMAGE = 'ghcr.io/project-osrm/osrm-backend';

/**
 * Refreshes the OSM extract behind a running OSRM instance.
 *
 * Local development does not need this: `docker compose --profile routing up`
 * downloads and preprocesses the extract on first run. This exists for a
 * deployed host, where the data has to be rebuilt in place and the serving
 * container restarted against it.
 */

const region = process.env.OSRM_REGION;
const dataPath = process.env.OSRM_DATA_PATH;
const containerName = process.env.OSRM_CONTAINER_NAME ?? 'osrm-server';

function fail(message: string): never {
  console.error(`[error] ${message}`);
  process.exit(1);
}

if (region === undefined) fail('OSRM_REGION is not set. Example: europe/austria');
if (dataPath === undefined) fail('OSRM_DATA_PATH is not set. Example: /opt/osrm/data');

try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
  fail('Docker is not running or not reachable.');
}

const regionName = region.split('/').pop() as string;
const pbfFile = path.join(dataPath, `${regionName}.osm.pbf`);
const downloadUrl = `https://download.geofabrik.de/${region}-latest.osm.pbf`;

function osrmStep(label: string, ...args: string[]): void {
  console.log(`\n[${label}] running`);
  execFileSync('docker', ['run', '--rm', '-v', `${dataPath}:/data`, OSRM_IMAGE, ...args], {
    stdio: 'inherit',
  });
  console.log(`[${label}] done`);
}

async function download(url: string, destination: string): Promise<void> {
  console.log(`\n[download] ${url}`);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} while downloading the extract`);
  if (res.body === null) throw new Error('The download returned an empty body');

  // Write to a temporary name first, so an interrupted run cannot leave a
  // truncated file that looks complete to the next one.
  const temp = `${destination}.tmp`;
  await pipeline(res.body, fs.createWriteStream(temp));
  fs.renameSync(temp, destination);

  console.log(`[download] saved to ${destination}`);
}

async function main(): Promise<void> {
  console.log(`\nRegion:    ${region}`);
  console.log(`Data path: ${dataPath}\n`);

  fs.mkdirSync(dataPath as string, { recursive: true });

  await download(downloadUrl, pbfFile);

  osrmStep('extract', 'osrm-extract', '-p', '/opt/car.lua', `/data/${regionName}.osm.pbf`);
  osrmStep('partition', 'osrm-partition', `/data/${regionName}.osrm`);
  osrmStep('customize', 'osrm-customize', `/data/${regionName}.osrm`);

  try {
    execFileSync('docker', ['restart', containerName], { stdio: 'inherit' });
    console.log(`\nOSRM data updated and "${containerName}" restarted.\n`);
  } catch {
    console.log(`\nData is ready, but no container named "${containerName}" is running.`);
    console.log('Start one with:\n');
    console.log(`  docker run -d --name ${containerName} --restart unless-stopped \\`);
    console.log(`    -p 5000:5000 -v "${dataPath}:/data" \\`);
    console.log(`    ${OSRM_IMAGE} \\`);
    console.log(`    osrm-routed --algorithm mld /data/${regionName}.osrm\n`);
  }
}

try {
  await main();
} catch (err) {
  console.error('\n[error]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
