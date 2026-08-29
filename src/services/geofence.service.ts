import { validatePolygon } from '../lib/geojson.ts';
import type { GeofenceMatch, GeofenceRepository } from '../repositories/geofence.repository.ts';
import type { TaggedCache } from '../lib/tagged-cache.ts';
import { cacheTag } from './spatial-cache.ts';

export interface GeofenceSyncInput {
  externalId: number;
  entityId: string;
  entityType: string;
  tenantId: number;
  /** Unvalidated client input; narrowed by validatePolygon before it is stored. */
  area: unknown;
  isActive: boolean;
}

export class GeofenceService {
  readonly #geofences: GeofenceRepository;
  readonly #cache: TaggedCache<GeofenceMatch[] | { inside: boolean }>;

  constructor(
    geofences: GeofenceRepository,
    cache: TaggedCache<GeofenceMatch[] | { inside: boolean }>,
  ) {
    this.#geofences = geofences;
    this.#cache = cache;
  }

  /** Returns a rejection reason, or null once the geofence is stored. */
  async sync(input: GeofenceSyncInput): Promise<string | null> {
    const validation = validatePolygon(input.area);
    if (!validation.ok) return validation.reason;

    // Re-syncing under a new type leaves the old type's answers naming it.
    const previousType = await this.#geofences.upsert({ ...input, area: validation.polygon });

    this.#cache.invalidate(cacheTag(input.entityType, input.tenantId));
    if (previousType !== null && previousType !== input.entityType) {
      this.#cache.invalidate(cacheTag(previousType, input.tenantId));
    }
    return null;
  }

  /** Returns false when no geofence with that id belongs to the tenant. */
  async delete(externalId: number, tenantId: number): Promise<boolean> {
    const entityType = await this.#geofences.deleteByExternalId(externalId, tenantId);
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
    const key = `geofence:check\x00${tag}\x00${entityId}\x00${lat}\x00${lng}`;

    const cached = this.#cache.get(key);
    if (cached !== undefined && !Array.isArray(cached)) return cached;

    const inside = await this.#geofences.coversPoint(tenantId, entityType, entityId, lng, lat);
    this.#cache.set(tag, key, { inside });
    return { inside };
  }

  async findCovering(
    tenantId: number,
    entityType: string,
    lng: number,
    lat: number,
  ): Promise<GeofenceMatch[]> {
    const tag = cacheTag(entityType, tenantId);
    const key = `geofence:check\x00${tag}\x00${lat}\x00${lng}`;

    const cached = this.#cache.get(key);
    if (Array.isArray(cached)) return cached;

    const rows = await this.#geofences.findCovering(tenantId, entityType, lng, lat);
    this.#cache.set(tag, key, rows);
    return rows;
  }
}
