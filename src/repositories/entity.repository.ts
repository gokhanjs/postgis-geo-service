import type { Pool } from 'pg';
import { withTenant } from './tenant-scope.ts';

export interface EntityLocationInput {
  entityId: string;
  entityType: string;
  tenantId: number;
  lat: number;
  lng: number;
  isActive: boolean;
}

export interface NearbyQuery {
  tenantId: number;
  entityType: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface NearbyRow {
  entity_id: string;
  /** numeric, so node-postgres hands it back as a string. */
  distance_km: string;
}

export interface EntityCoordinate {
  entity_id: string;
  entity_type: string;
  lng: number;
  lat: number;
}

export class EntityRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async upsert(input: EntityLocationInput): Promise<void> {
    await withTenant(this.#pool, input.tenantId, async (client) => {
      await client.query(
        `
        INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location, is_active)
        VALUES ($1, $2, $3, ST_Point($4, $5, 4326)::geography, $6)
        ON CONFLICT (entity_id, entity_type, tenant_id)
        DO UPDATE SET
          location   = EXCLUDED.location,
          is_active  = EXCLUDED.is_active,
          updated_at = NOW();
        `,
        [input.entityId, input.entityType, input.tenantId, input.lng, input.lat, input.isActive],
      );
    });
  }

  async findNearby(query: NearbyQuery): Promise<NearbyRow[]> {
    return withTenant(this.#pool, query.tenantId, async (client) => {
      // ST_DWithin filters and ST_Distance reports on the same spheroid, so a
      // row can never be listed with a distance outside the radius it passed.
      const { rows } = await client.query<NearbyRow>(
        `
        SELECT
          entity_id,
          ROUND((ST_Distance(location, $1::geography) / 1000)::numeric, 2) AS distance_km
        FROM entity_locations
        WHERE is_active
          AND entity_type = $2
          AND tenant_id   = $3
          AND ST_DWithin(location, $1::geography, $4)
        ORDER BY distance_km ASC;
        `,
        [
          pointLiteral(query.lng, query.lat),
          query.entityType,
          query.tenantId,
          query.radiusKm * 1000,
        ],
      );
      return rows;
    });
  }

  async findCoordinates(
    tenantId: number,
    entityIds: readonly string[],
    entityTypes: readonly string[],
  ): Promise<EntityCoordinate[]> {
    return withTenant(this.#pool, tenantId, async (client) => {
      const { rows } = await client.query<EntityCoordinate>(
        `
        SELECT entity_id, entity_type,
               ST_X(location::geometry) AS lng,
               ST_Y(location::geometry) AS lat
        FROM   entity_locations
        WHERE  tenant_id   = $1
          AND  entity_id   = ANY($2)
          AND  entity_type = ANY($3)
          AND  is_active
        `,
        [tenantId, entityIds, entityTypes],
      );
      return rows;
    });
  }
}

function pointLiteral(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
