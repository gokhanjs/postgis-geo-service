import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AdminKeyBody, AdminKeyParams } from '../schemas/index.ts';

const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/admin/keys',
    { preHandler: [app.authenticateAdmin], schema: { body: AdminKeyBody } },
    async (request) => {
      const { tenant_id, project_name } = request.body;
      const key = await app.services.credentials.issueApiKey(tenant_id, project_name);

      return { key, tenant_id, project_name };
    },
  );

  app.get('/api/v1/admin/keys', { preHandler: [app.authenticateAdmin] }, async () => {
    return app.services.credentials.listApiKeys();
  });

  app.delete(
    '/api/v1/admin/keys/:key',
    { preHandler: [app.authenticateAdmin], schema: { params: AdminKeyParams } },
    async (request, reply) => {
      const revoked = await app.services.credentials.revokeApiKey(request.params.key);

      if (!revoked) return reply.code(404).send({ error: 'Key not found' });

      return { success: true };
    },
  );
};

export default adminRoutes;
