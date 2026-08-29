import type { preHandlerHookHandler } from 'fastify';
import type pg from 'pg';
import type { Services } from '../container.ts';
import type { TenantContext } from '../repositories/credential.repository.ts';

declare module 'fastify' {
  interface FastifyInstance {
    pg: pg.Pool;
    services: Services;
    authenticateApiKey: preHandlerHookHandler;
    authenticateAdmin: preHandlerHookHandler;
    /** Charges one request against the tenant's quota, raising 429 when spent. */
    chargeTenantQuota: (tenantId: number) => void;
  }

  interface FastifyRequest {
    /** Set by the authenticateApiKey preHandler; null until it runs. */
    tenantContext: TenantContext | null;
    /** The calling tenant. Throws when read outside an authenticated route. */
    readonly tenant: TenantContext;
  }
}
