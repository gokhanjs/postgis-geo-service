import { LRUCache } from 'lru-cache';

export interface TaggedCacheOptions {
  max: number;
  ttl: number;
}

/**
 * An LRU cache whose entries carry a tag, so a write to one tenant's data can
 * drop exactly the reads it invalidates instead of the whole cache.
 *
 * The tag index is kept in step with evictions through the LRU's dispose hook.
 * Without that, entries dropped by size or TTL would stay referenced in the
 * index forever and the map would grow without bound.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- LRUCache requires a non-nullish value type, which is what `{}` expresses
export class TaggedCache<V extends {}> {
  readonly #entries: LRUCache<string, V>;
  readonly #keysByTag = new Map<string, Set<string>>();
  readonly #tagByKey = new Map<string, string>();

  constructor(options: TaggedCacheOptions) {
    this.#entries = new LRUCache<string, V>({
      max: options.max,
      ttl: options.ttl,
      dispose: (_value, key) => this.#forget(key),
    });
  }

  get(key: string): V | undefined {
    return this.#entries.get(key);
  }

  set(tag: string, key: string, value: V): void {
    this.#entries.set(key, value);
    this.#tagByKey.set(key, tag);

    let keys = this.#keysByTag.get(tag);
    if (keys === undefined) {
      keys = new Set();
      this.#keysByTag.set(tag, keys);
    }
    keys.add(key);
  }

  invalidate(tag: string): void {
    const keys = this.#keysByTag.get(tag);
    if (keys === undefined) return;

    // delete() fires dispose(), which clears the index entries for each key.
    for (const key of [...keys]) {
      this.#entries.delete(key);
    }
    this.#keysByTag.delete(tag);
  }

  /** Number of tracked keys. Exposed so tests can assert the index stays bounded. */
  get indexSize(): number {
    return this.#tagByKey.size;
  }

  #forget(key: string): void {
    const tag = this.#tagByKey.get(key);
    if (tag === undefined) return;

    this.#tagByKey.delete(key);
    const keys = this.#keysByTag.get(tag);
    if (keys === undefined) return;

    keys.delete(key);
    if (keys.size === 0) this.#keysByTag.delete(tag);
  }
}
