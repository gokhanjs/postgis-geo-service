import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RoutingBody } from '../schemas/index.ts';

const routingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/routing/distances',
    { preHandler: [app.authenticateApiKey], schema: { body: RoutingBody } },
    async (request, reply) => {
      const { origin, destinations } = request.body;

      const result = await app.services.routing.distances(
        request.tenant.tenant_id,
        origin,
        destinations,
      );

      switch (result.status) {
        case 'disabled':
          return reply
            .code(503)
            .send({ error: 'Routing service not configured', osrm: 'disabled' });
        case 'unreachable':
          return reply
            .code(503)
            .send({ error: 'Routing service unreachable', osrm: 'unreachable' });
        case 'ok':
          return result.destinations;
      }
    },
  );
};

export default routingRoutes;
