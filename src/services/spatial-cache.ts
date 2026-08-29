import type { TaggedCache } from '../lib/tagged-cache.ts';
import type { NearbyRow } from '../repositories/entity.repository.ts';
import type { ZoneMatch } from '../repositories/zone.repository.ts';

/**
 * Everything the spatial cache may hold. One store backs both read paths so a
 * write to a tenant's entities drops its zone answers too, which means the
 * value type has to span both shapes.
 */
export type SpatialCacheValue = NearbyRow[] | ZoneMatch[] | { inside: boolean };

export type SpatialCache = TaggedCache<SpatialCacheValue>;

/**
 * Groups every cached read that a write to (entityType, tenantId) invalidates.
 * NUL separates the parts so no combination of legal values can collide.
 */
export function cacheTag(entityType: string, tenantId: number): string {
  return `${entityType}\x00${tenantId}`;
}
