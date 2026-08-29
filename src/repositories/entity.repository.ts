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
  limit: number;
  /** Distance in km of the last row of the previous page. */
  afterDistanceKm: number | null;
  afterEntityId: string | null;
}

export interface NearbyRow {
  entity_id: string;
  distance_km: number;
}

export interface EntityCoordinate {
  entity_id: string;
  entity_type: string;
  lng: number;
  lat: number;
}

export interface DestinationRef {
  entity_id: string;
  entity_type: string;
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

  /**
   * Pages on (distance, entity_id) rather than an offset, so a concurrent write
   * cannot make a row appear twice or vanish between pages.
   */
  async findNearby(query: NearbyQuery): Promise<NearbyRow[]> {
    return withTenant(this.#pool, query.tenantId, async (client) => {
      const { rows } = await client.query<{ entity_id: string; distance_km: string }>(
        `
        SELECT entity_id,
               ROUND((ST_Distance(location, $1::geography) / 1000)::numeric, 3) AS distance_km
        FROM entity_locations
        WHERE is_active
          AND entity_type = $2
          AND tenant_id   = $3
          AND ST_DWithin(location, $1::geography, $4)
          AND (
            $5::numeric IS NULL
            OR (ROUND((ST_Distance(location, $1::geography) / 1000)::numeric, 3), entity_id)
               > ($5::numeric, $6::text)
          )
        ORDER BY distance_km ASC, entity_id ASC
        LIMIT $7;
        `,
        [
          pointLiteral(query.lng, query.lat),
          query.entityType,
          query.tenantId,
          query.radiusKm * 1000,
          query.afterDistanceKm,
          query.afterEntityId,
          query.limit,
        ],
      );

      return rows.map((row) => ({
        entity_id: row.entity_id,
        distance_km: Number(row.distance_km),
      }));
    });
  }

  /**
   * Matches identifier and type as a pair. Filtering the two lists separately
   * also returned combinations the caller never asked for.
   */
  async findCoordinates(
    tenantId: number,
    destinations: readonly DestinationRef[],
  ): Promise<EntityCoordinate[]> {
    return withTenant(this.#pool, tenantId, async (client) => {
      const { rows } = await client.query<EntityCoordinate>(
        `
        SELECT e.entity_id, e.entity_type,
               ST_X(e.location::geometry) AS lng,
               ST_Y(e.location::geometry) AS lat
        FROM   entity_locations e
        JOIN   unnest($2::text[], $3::text[]) AS wanted(entity_id, entity_type)
          ON   e.entity_id = wanted.entity_id AND e.entity_type = wanted.entity_type
        WHERE  e.tenant_id = $1
          AND  e.is_active
        `,
        [tenantId, destinations.map((d) => d.entity_id), destinations.map((d) => d.entity_type)],
      );
      return rows;
    });
  }
}

function pointLiteral(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
