import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import { RoutingBody } from '../schemas/index.ts';

const routingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/routing/distances',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['routing'],
        summary: 'Road distance and duration from one origin to many entities',
        body: RoutingBody,
      },
    },
    async (request) => {
      const { origin, destinations } = request.body;

      const result = await app.services.routing.distances(
        request.tenant.tenant_id,
        origin,
        destinations,
      );

      switch (result.status) {
        case 'disabled':
          throw problems.routingDisabled();
        case 'unreachable':
          throw problems.routingUnreachable();
        case 'ok':
          return result.destinations;
      }
    },
  );
};

export default routingRoutes;
