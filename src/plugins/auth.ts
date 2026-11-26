import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { problems } from '../lib/problem.ts';
import type { TenantContext } from '../repositories/credential.repository.ts';

/**
 * Adds the preHandler every guarded route uses.
 *
 * authenticateApiKey resolves the calling tenant onto the request, so handlers
 * read `request.tenant` and never touch the key header themselves. The getter
 * throws rather than returning undefined, which turns a route that forgets the
 * preHandler into an immediate, obvious failure instead of a query silently
 * scoped to nothing.
 */
export default fp(
  async (app) => {
    app.decorateRequest('tenantContext', null);

    app.decorateRequest('tenant', {
      getter(this: FastifyRequest): TenantContext {
        const tenant = this.tenantContext;
        if (tenant === null) {
          throw new Error('Route read request.tenant without the authenticateApiKey preHandler');
        }
        return tenant;
      },
    });

    app.decorate('authenticateApiKey', async (request: FastifyRequest) => {
      const key = request.headers['x-api-key'];
      if (typeof key !== 'string' || key.length === 0) throw problems.missingApiKey();

      const tenant = await app.services.credentials.resolveTenant(key);
      if (tenant === null) throw problems.invalidApiKey();

      request.tenantContext = tenant;
      app.chargeTenantQuota(tenant.tenant_id);
    });
  },
  { name: 'auth' },
);
