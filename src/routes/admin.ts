import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import {
  AdminKeyBody,
  AdminKeyParams,
  adminSecurity,
  guardedResponses,
  IssuedKeyResponse,
  KeyListResponse,
  ProblemResponse,
  SuccessResponse,
} from '../schemas/index.ts';

const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/admin/keys',
    {
      preHandler: [app.authenticateAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Issue an API key',
        security: adminSecurity,
        body: AdminKeyBody,
        response: { 200: IssuedKeyResponse, ...guardedResponses },
      },
    },
    async (request) => {
      const { tenant_id, project_name } = request.body;
      return app.services.credentials.issueApiKey(tenant_id, project_name);
    },
  );

  app.get(
    '/api/v1/admin/keys',
    {
      preHandler: [app.authenticateAdmin],
      schema: {
        tags: ['admin'],
        summary: 'List issued keys',
        security: adminSecurity,
        response: { 200: KeyListResponse, ...guardedResponses },
      },
    },
    async () => {
      return app.services.credentials.listApiKeys();
    },
  );

  app.delete(
    '/api/v1/admin/keys/:prefix',
    {
      preHandler: [app.authenticateAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Revoke a key by prefix',
        security: adminSecurity,
        params: AdminKeyParams,
        response: { 200: SuccessResponse, 404: ProblemResponse, ...guardedResponses },
      },
    },
    async (request) => {
      const revoked = await app.services.credentials.revokeApiKey(request.params.prefix);
      if (!revoked) throw problems.notFound('Key');

      return { success: true };
    },
  );
};

export default adminRoutes;
