import type { Pool } from 'pg';
import type { PolygonGeoJson } from '../lib/geojson.ts';

export interface ZoneInput {
  id: number;
  entityId: string;
  entityType: string;
  tenantId: number;
  geojson: PolygonGeoJson;
  isActive: boolean;
}

export interface ZoneMatch {
  entity_id: string;
}

export class ZoneRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async upsert(input: ZoneInput): Promise<void> {
    await this.#pool.query(
      `
      INSERT INTO zones (id, entity_id, entity_type, tenant_id, zone, is_active)
      VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6)
      ON CONFLICT (id)
      DO UPDATE SET
        entity_id   = $2,
        entity_type = $3,
        tenant_id   = $4,
        zone        = ST_GeomFromGeoJSON($5),
        is_active   = $6;
      `,
      [
        input.id,
        input.entityId,
        input.entityType,
        input.tenantId,
        JSON.stringify(input.geojson),
        input.isActive,
      ],
    );
  }

  /** Returns the deleted zone's entity type, or null when nothing matched. */
  async deleteById(id: number, tenantId: number): Promise<string | null> {
    const { rows } = await this.#pool.query<{ entity_type: string }>(
      'DELETE FROM zones WHERE id = $1 AND tenant_id = $2 RETURNING entity_type',
      [id, tenantId],
    );
    return rows[0]?.entity_type ?? null;
  }

  async coversPoint(
    tenantId: number,
    entityType: string,
    entityId: string,
    lng: number,
    lat: number,
  ): Promise<boolean> {
    const { rows } = await this.#pool.query<{ inside: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM zones
        WHERE is_active   = true
          AND entity_type = $1
          AND tenant_id   = $2
          AND entity_id   = $3
          AND ST_Contains(zone, ST_SetSRID(ST_MakePoint($4, $5), 4326))
      ) AS inside;
      `,
      [entityType, tenantId, entityId, lng, lat],
    );
    return rows[0]?.inside ?? false;
  }

  async findCovering(
    tenantId: number,
    entityType: string,
    lng: number,
    lat: number,
  ): Promise<ZoneMatch[]> {
    const { rows } = await this.#pool.query<ZoneMatch>(
      `
      SELECT entity_id
      FROM zones
      WHERE is_active   = true
        AND entity_type = $1
        AND tenant_id   = $2
        AND ST_Contains(zone, ST_SetSRID(ST_MakePoint($3, $4), 4326));
      `,
      [entityType, tenantId, lng, lat],
    );
    return rows;
  }
}
