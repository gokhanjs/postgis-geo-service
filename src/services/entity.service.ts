import type {
  EntityLocationInput,
  EntityRepository,
  NearbyQuery,
  NearbyRow,
} from '../repositories/entity.repository.ts';
import { cacheTag, readCached, type SpatialCache } from './spatial-cache.ts';

export class EntityService {
  readonly #entities: EntityRepository;
  readonly #cache: SpatialCache;

  constructor(entities: EntityRepository, cache: SpatialCache) {
    this.#entities = entities;
    this.#cache = cache;
  }

  async syncLocation(input: EntityLocationInput): Promise<void> {
    await this.#entities.upsert(input);
    this.#cache.invalidate(cacheTag(input.entityType, input.tenantId));
  }

  async findNearby(query: NearbyQuery): Promise<NearbyRow[]> {
    const tag = cacheTag(query.entityType, query.tenantId);
    const key = `nearby\x00${tag}\x00${query.lat}\x00${query.lng}\x00${query.radiusKm}`;

    const cached = readCached(this.#cache, key, 'nearby');
    if (cached !== undefined) return cached.rows;

    const rows = await this.#entities.findNearby(query);
    this.#cache.set(tag, key, { kind: 'nearby', rows });
    return rows;
  }
}
