import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

export const ADMIN_TOKEN = 'gat_test_admin_token';

/** Wipes every table the suite writes to, so each test starts from a known state. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE entity_locations, zones, api_keys, admin_tokens, collection_tokens');
  await pool.query('INSERT INTO admin_tokens (token) VALUES ($1)', [ADMIN_TOKEN]);
}

/** Issues an API key bound to a tenant, mirroring what the admin endpoint does. */
export async function createApiKey(
  pool: Pool,
  tenantId: number,
  projectName = 'acme-delivery',
): Promise<string> {
  const key = `gsk_${randomBytes(24).toString('hex')}`;
  await pool.query('INSERT INTO api_keys (key, tenant_id, project_name) VALUES ($1, $2, $3)', [
    key,
    tenantId,
    projectName,
  ]);
  return key;
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
