import type { Pool } from 'pg';
import type { PolygonGeoJson } from '../lib/geojson.ts';
import { withTenant } from './tenant-scope.ts';

export interface GeofenceInput {
  externalId: number;
  entityId: string;
  entityType: string;
  tenantId: number;
  area: PolygonGeoJson;
  isActive: boolean;
}

export interface GeofenceMatch {
  entity_id: string;
}

export class GeofenceRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * The conflict target is (tenant_id, external_id), so an identifier a tenant
   * chose can only ever replace that tenant's own row.
   */
  async upsert(input: GeofenceInput): Promise<void> {
    await withTenant(this.#pool, input.tenantId, async (client) => {
      await client.query(
        `
        INSERT INTO geofences (external_id, entity_id, entity_type, tenant_id, area, is_active)
        VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5)::geography, $6)
        ON CONFLICT (tenant_id, external_id)
        DO UPDATE SET
          entity_id   = EXCLUDED.entity_id,
          entity_type = EXCLUDED.entity_type,
          area        = EXCLUDED.area,
          is_active   = EXCLUDED.is_active;
        `,
        [
          input.externalId,
          input.entityId,
          input.entityType,
          input.tenantId,
          JSON.stringify(input.area),
          input.isActive,
        ],
      );
    });
  }

  /** Returns the deleted geofence's entity type, or null when nothing matched. */
  async deleteByExternalId(externalId: number, tenantId: number): Promise<string | null> {
    return withTenant(this.#pool, tenantId, async (client) => {
      const { rows } = await client.query<{ entity_type: string }>(
        'DELETE FROM geofences WHERE external_id = $1 AND tenant_id = $2 RETURNING entity_type',
        [externalId, tenantId],
      );
      return rows[0]?.entity_type ?? null;
    });
  }

  async coversPoint(
    tenantId: number,
    entityType: string,
    entityId: string,
    lng: number,
    lat: number,
  ): Promise<boolean> {
    return withTenant(this.#pool, tenantId, async (client) => {
      const { rows } = await client.query<{ inside: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM geofences
          WHERE is_active
            AND entity_type = $1
            AND tenant_id   = $2
            AND entity_id   = $3
            AND ST_Covers(area, $4::geography)
        ) AS inside;
        `,
        [entityType, tenantId, entityId, pointLiteral(lng, lat)],
      );
      return rows[0]?.inside ?? false;
    });
  }

  async findCovering(
    tenantId: number,
    entityType: string,
    lng: number,
    lat: number,
  ): Promise<GeofenceMatch[]> {
    return withTenant(this.#pool, tenantId, async (client) => {
      // ST_Covers rather than ST_Contains: a point exactly on a shared edge
      // belongs to both neighbours, where ST_Contains gives it to neither.
      const { rows } = await client.query<GeofenceMatch>(
        `
        SELECT DISTINCT entity_id
        FROM geofences
        WHERE is_active
          AND entity_type = $1
          AND tenant_id   = $2
          AND ST_Covers(area, $3::geography);
        `,
        [entityType, tenantId, pointLiteral(lng, lat)],
      );
      return rows;
    });
  }
}

function pointLiteral(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
