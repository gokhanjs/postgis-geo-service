import type { Pool } from 'pg';

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
    await this.#pool.query(
      `
      INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location, is_active)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)
      ON CONFLICT (entity_id, entity_type, tenant_id)
      DO UPDATE SET
        location  = ST_SetSRID(ST_MakePoint($4, $5), 4326),
        is_active = $6;
      `,
      [input.entityId, input.entityType, input.tenantId, input.lng, input.lat, input.isActive],
    );
  }

  async findNearby(query: NearbyQuery): Promise<NearbyRow[]> {
    const { rows } = await this.#pool.query<NearbyRow>(
      `
      SELECT
        entity_id,
        ROUND(
          (ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) / 1000)::numeric,
          2
        ) AS distance_km
      FROM entity_locations
      WHERE is_active   = true
        AND entity_type = $3
        AND tenant_id   = $4
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $5
        )
      ORDER BY distance_km ASC;
      `,
      [query.lng, query.lat, query.entityType, query.tenantId, query.radiusKm * 1000],
    );
    return rows;
  }

  async findCoordinates(
    tenantId: number,
    entityIds: readonly string[],
    entityTypes: readonly string[],
  ): Promise<EntityCoordinate[]> {
    const { rows } = await this.#pool.query<EntityCoordinate>(
      `
      SELECT entity_id, entity_type,
             ST_X(location::geometry) AS lng,
             ST_Y(location::geometry) AS lat
      FROM   entity_locations
      WHERE  tenant_id   = $1
        AND  entity_id   = ANY($2)
        AND  entity_type = ANY($3)
        AND  is_active   = true
      `,
      [tenantId, entityIds, entityTypes],
    );
    return rows;
  }
}
