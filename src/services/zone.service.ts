import { validatePolygon } from '../lib/geojson.ts';
import type { ZoneMatch, ZoneRepository } from '../repositories/zone.repository.ts';
import { cacheTag, readCached, type SpatialCache } from './spatial-cache.ts';

export interface ZoneSyncInput {
  id: number;
  entityId: string;
  entityType: string;
  tenantId: number;
  /** Unvalidated client input; narrowed by validatePolygon before it is stored. */
  geojson: unknown;
  isActive: boolean;
}

export class ZoneService {
  readonly #zones: ZoneRepository;
  readonly #cache: SpatialCache;

  constructor(zones: ZoneRepository, cache: SpatialCache) {
    this.#zones = zones;
    this.#cache = cache;
  }

  /** Returns a rejection reason, or null once the zone is stored. */
  async sync(input: ZoneSyncInput): Promise<string | null> {
    const validation = validatePolygon(input.geojson);
    if (!validation.ok) return validation.reason;

    await this.#zones.upsert({ ...input, geojson: validation.polygon });
    this.#cache.invalidate(cacheTag(input.entityType, input.tenantId));
    return null;
  }

  /** Returns false when no zone with that id belongs to the tenant. */
  async delete(id: number, tenantId: number): Promise<boolean> {
    const entityType = await this.#zones.deleteById(id, tenantId);
    if (entityType === null) return false;

    this.#cache.invalidate(cacheTag(entityType, tenantId));
    return true;
  }

  async isInside(
    tenantId: number,
    entityType: string,
    entityId: string,
    lng: number,
    lat: number,
  ): Promise<{ inside: boolean }> {
    const tag = cacheTag(entityType, tenantId);
    const key = `zones:check\x00${tag}\x00${entityId}\x00${lat}\x00${lng}`;

    const cached = readCached(this.#cache, key, 'zoneCheck');
    if (cached !== undefined) return { inside: cached.inside };

    const inside = await this.#zones.coversPoint(tenantId, entityType, entityId, lng, lat);
    this.#cache.set(tag, key, { kind: 'zoneCheck', inside });
    return { inside };
  }

  async findCovering(
    tenantId: number,
    entityType: string,
    lng: number,
    lat: number,
  ): Promise<ZoneMatch[]> {
    const tag = cacheTag(entityType, tenantId);
    const key = `zones:check\x00${tag}\x00${lat}\x00${lng}`;

    const cached = readCached(this.#cache, key, 'zoneMatches');
    if (cached !== undefined) return cached.rows;

    const rows = await this.#zones.findCovering(tenantId, entityType, lng, lat);
    this.#cache.set(tag, key, { kind: 'zoneMatches', rows });
    return rows;
  }
}
