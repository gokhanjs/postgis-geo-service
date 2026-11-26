import type { Pool } from 'pg';
import { generateApiKey } from '../../src/lib/credentials.ts';

/** Wipes every table the suite writes to, so each test starts from a known state. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE entity_locations, geofences, api_keys');
}

/** Issues an API key bound to a tenant, mirroring what the key CLI does. */
export async function createApiKey(
  pool: Pool,
  tenantId: number,
  projectName = 'acme-delivery',
): Promise<string> {
  const issued = generateApiKey();
  await pool.query(
    'INSERT INTO api_keys (key_hash, key_prefix, tenant_id, project_name) VALUES ($1, $2, $3, $4)',
    [issued.hash, issued.prefix, tenantId, projectName],
  );
  return issued.key;
}

/** A small square polygon centred on the given point, as GeoJSON. */
export function squarePolygon(lng: number, lat: number, size = 0.01) {
  const h = size / 2;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - h, lat - h],
        [lng + h, lat - h],
        [lng + h, lat + h],
        [lng - h, lat + h],
        [lng - h, lat - h],
      ],
    ],
  };
}
