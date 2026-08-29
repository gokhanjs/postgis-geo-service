import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import { TokenParams } from '../schemas/index.ts';

const collectionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/api/v1/collection/download/:token',
    { schema: { params: TokenParams } },
    async (request, reply) => {
      const collection = await app.services.collections.download(request.params.token);

      if (collection === null) throw problems.notFound('Download link');

      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', 'attachment; filename="geo-service.postman_collection.json"')
        .send(collection);
    },
  );
};

export default collectionRoutes;
