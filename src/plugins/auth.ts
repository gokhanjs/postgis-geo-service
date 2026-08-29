import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { TenantContext } from '../repositories/credential.repository.ts';

/**
 * Adds the two preHandlers every guarded route uses.
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

    app.decorate('authenticateApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
      const key = request.headers['x-api-key'];
      if (typeof key !== 'string' || key.length === 0) {
        return reply.code(401).send({ error: 'Missing x-api-key header' });
      }

      const tenant = await app.services.credentials.resolveTenant(key);
      if (tenant === null) {
        return reply.code(401).send({ error: 'Invalid or inactive API key' });
      }

      request.tenantContext = tenant;
    });

    app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.headers['x-admin-token'];
      if (typeof token !== 'string' || token.length === 0) {
        return reply.code(401).send({ error: 'Missing x-admin-token header' });
      }

      if (!(await app.services.credentials.isValidAdminToken(token))) {
        return reply.code(401).send({ error: 'Invalid admin token' });
      }
    });
  },
  { name: 'auth' },
);
