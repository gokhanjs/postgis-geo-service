import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/health', async () => app.services.health.check());
};

export default healthRoutes;
