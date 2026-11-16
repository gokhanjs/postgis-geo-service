import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';
import { config } from '../config/index.ts';
import { problems } from '../lib/problem.ts';

/** Charged where auth resolves a tenant; a global hook runs too early to know one. */
export default fp(
  async (app) => {
    const used = new LRUCache<number, number>({
      max: 10_000,
      ttl: config.rateLimit.timeWindow,
      // A fixed window: refreshing the TTL on every charge would never let a steady caller back in.
      noUpdateTTL: true,
    });

    app.decorate('chargeTenantQuota', (tenantId: number) => {
      const spent = (used.get(tenantId) ?? 0) + 1;
      used.set(tenantId, spent);

      if (spent > config.rateLimit.max) throw problems.tooManyRequests();
    });
  },
  { name: 'tenant-quota' },
);
