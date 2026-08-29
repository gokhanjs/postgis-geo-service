import { validatePolygon } from '../lib/geojson.ts';
import type { ZoneInput, ZoneMatch, ZoneRepository } from '../repositories/zone.repository.ts';
import { cacheTag, type SpatialCache } from './spatial-cache.ts';

export class ZoneService {
  readonly #zones: ZoneRepository;
  readonly #cache: SpatialCache;

  constructor(zones: ZoneRepository, cache: SpatialCache) {
    this.#zones = zones;
    this.#cache = cache;
  }

  /** Returns a rejection reason, or null once the zone is stored. */
  async sync(input: ZoneInput): Promise<string | null> {
    const invalid = validatePolygon(input.geojson);
    if (invalid !== null) return invalid;

    await this.#zones.upsert(input);
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

    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached as { inside: boolean };

    const inside = await this.#zones.coversPoint(tenantId, entityType, entityId, lng, lat);
    const result = { inside };
    this.#cache.set(tag, key, result);
    return result;
  }

  async findCovering(
    tenantId: number,
    entityType: string,
    lng: number,
    lat: number,
  ): Promise<ZoneMatch[]> {
    const tag = cacheTag(entityType, tenantId);
    const key = `zones:check\x00${tag}\x00${lat}\x00${lng}`;

    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached as ZoneMatch[];

    const rows = await this.#zones.findCovering(tenantId, entityType, lng, lat);
    this.#cache.set(tag, key, rows);
    return rows;
  }
}
