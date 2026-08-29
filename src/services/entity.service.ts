import type {
  EntityLocationInput,
  EntityRepository,
  NearbyRow,
} from '../repositories/entity.repository.ts';
import type { TaggedCache } from '../lib/tagged-cache.ts';
import { cacheTag } from './spatial-cache.ts';

export interface NearbyRequest {
  tenantId: number;
  entityType: string;
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
  cursor: string | undefined;
}

export interface NearbyPage {
  results: NearbyRow[];
  next_cursor: string | null;
}

export class EntityService {
  readonly #entities: EntityRepository;
  readonly #cache: TaggedCache<NearbyPage>;

  constructor(entities: EntityRepository, cache: TaggedCache<NearbyPage>) {
    this.#entities = entities;
    this.#cache = cache;
  }

  async syncLocation(input: EntityLocationInput): Promise<void> {
    await this.#entities.upsert(input);
    this.#cache.invalidate(cacheTag(input.entityType, input.tenantId));
  }

  async findNearby(request: NearbyRequest): Promise<NearbyPage> {
    const tag = cacheTag(request.entityType, request.tenantId);
    const key = [
      'nearby',
      tag,
      request.lat,
      request.lng,
      request.radiusKm,
      request.limit,
      request.cursor ?? '',
    ].join('\x00');

    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;

    const after = decodeCursor(request.cursor);
    const results = await this.#entities.findNearby({
      tenantId: request.tenantId,
      entityType: request.entityType,
      lat: request.lat,
      lng: request.lng,
      radiusKm: request.radiusKm,
      limit: request.limit,
      afterDistanceKm: after?.distanceKm ?? null,
      afterEntityId: after?.entityId ?? null,
    });

    const last = results[results.length - 1];
    const page: NearbyPage = {
      results,
      // A full page implies there may be more; a short one is the end.
      next_cursor:
        results.length === request.limit && last !== undefined ? encodeCursor(last) : null,
    };

    this.#cache.set(tag, key, page);
    return page;
  }
}

interface Cursor {
  distanceKm: number;
  entityId: string;
}

function encodeCursor(row: NearbyRow): string {
  return Buffer.from(`${row.distance_km}\x00${row.entity_id}`, 'utf8').toString('base64url');
}

/** A malformed cursor reads as "start from the beginning" rather than an error. */
function decodeCursor(cursor: string | undefined): Cursor | null {
  if (cursor === undefined) return null;

  const [distance, entityId] = Buffer.from(cursor, 'base64url').toString('utf8').split('\x00');
  const distanceKm = Number(distance);

  if (entityId === undefined || !Number.isFinite(distanceKm)) return null;
  return { distanceKm, entityId };
}
