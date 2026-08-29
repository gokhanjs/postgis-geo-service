import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import { AdminKeyBody, AdminKeyParams } from '../schemas/index.ts';

const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/admin/keys',
    { preHandler: [app.authenticateAdmin], schema: { body: AdminKeyBody } },
    async (request) => {
      const { tenant_id, project_name } = request.body;
      return app.services.credentials.issueApiKey(tenant_id, project_name);
    },
  );

  app.get('/api/v1/admin/keys', { preHandler: [app.authenticateAdmin] }, async () => {
    return app.services.credentials.listApiKeys();
  });

  app.delete(
    '/api/v1/admin/keys/:key',
    { preHandler: [app.authenticateAdmin], schema: { params: AdminKeyParams } },
    async (request) => {
      const revoked = await app.services.credentials.revokeApiKey(request.params.key);
      if (!revoked) throw problems.notFound('Key');

      return { success: true };
    },
  );
};

export default adminRoutes;
