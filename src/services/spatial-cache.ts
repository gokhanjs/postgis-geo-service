import type { TaggedCache } from '../lib/tagged-cache.ts';
import type { NearbyRow } from '../repositories/entity.repository.ts';
import type { GeofenceMatch } from '../repositories/geofence.repository.ts';

/**
 * One store backs both read paths so a write invalidates each. `kind` lets a
 * reader confirm the shape rather than trusting key prefixes not to collide.
 */
export type SpatialCacheValue =
  | { kind: 'nearby'; rows: NearbyRow[] }
  | { kind: 'geofenceMatches'; rows: GeofenceMatch[] }
  | { kind: 'geofenceCheck'; inside: boolean };

export type SpatialCache = TaggedCache<SpatialCacheValue>;

/** NUL separates the parts so no combination of legal values can collide. */
export function cacheTag(entityType: string, tenantId: number): string {
  return `${entityType}\x00${tenantId}`;
}

/** Returns the entry only when it holds the expected shape. */
export function readCached<K extends SpatialCacheValue['kind']>(
  cache: SpatialCache,
  key: string,
  kind: K,
): Extract<SpatialCacheValue, { kind: K }> | undefined {
  const cached = cache.get(key);
  if (cached === undefined || cached.kind !== kind) return undefined;
  return cached as Extract<SpatialCacheValue, { kind: K }>;
}
