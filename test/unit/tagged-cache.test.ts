import { describe, expect, it } from 'vitest';
import { TaggedCache } from '../../src/lib/tagged-cache.ts';

/**
 * Regression cover for the leak this cache replaced: a tag index that never
 * learned about evictions and grew for the life of the process.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TaggedCache', () => {
  it('returns what was stored and forgets what was not', () => {
    const cache = new TaggedCache<{ n: number }>({ max: 10, ttl: 60_000 });

    cache.set('tag-a', 'key-1', { n: 1 });

    expect(cache.get('key-1')).toEqual({ n: 1 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('drops every key sharing a tag, and nothing else', () => {
    const cache = new TaggedCache<{ n: number }>({ max: 10, ttl: 60_000 });

    cache.set('tag-a', 'a1', { n: 1 });
    cache.set('tag-a', 'a2', { n: 2 });
    cache.set('tag-b', 'b1', { n: 3 });

    cache.invalidate('tag-a');

    expect(cache.get('a1')).toBeUndefined();
    expect(cache.get('a2')).toBeUndefined();
    expect(cache.get('b1')).toEqual({ n: 3 });
    expect(cache.indexSize).toBe(1);
  });

  it('keeps the index bounded when entries are evicted for size', () => {
    const max = 8;
    const cache = new TaggedCache<{ n: number }>({ max, ttl: 60_000 });

    // Ten times capacity, each under its own tag: the shape that used to leak.
    for (let i = 0; i < max * 10; i += 1) {
      cache.set(`tag-${i}`, `key-${i}`, { n: i });
    }

    expect(cache.indexSize).toBeLessThanOrEqual(max);
  });

  it('keeps the index bounded when entries expire', async () => {
    const cache = new TaggedCache<{ n: number }>({ max: 100, ttl: 10 });

    for (let i = 0; i < 20; i += 1) {
      cache.set(`tag-${i}`, `key-${i}`, { n: i });
    }
    expect(cache.indexSize).toBe(20);

    await sleep(30);

    // Expiry is lazy, so reading is what lets the cache notice and dispose.
    for (let i = 0; i < 20; i += 1) {
      expect(cache.get(`key-${i}`)).toBeUndefined();
    }

    expect(cache.indexSize).toBe(0);
  });

  it('moves a key cleanly when it is re-tagged', () => {
    const cache = new TaggedCache<{ n: number }>({ max: 10, ttl: 60_000 });

    cache.set('tag-a', 'shared', { n: 1 });
    cache.set('tag-b', 'shared', { n: 2 });

    // The key belongs to tag-b now, so only tag-b may reach it.
    cache.invalidate('tag-a');
    expect(cache.get('shared')).toEqual({ n: 2 });

    cache.invalidate('tag-b');
    expect(cache.get('shared')).toBeUndefined();
    expect(cache.indexSize).toBe(0);
  });
});
