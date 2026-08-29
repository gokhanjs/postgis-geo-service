import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Liveness answers "is this process working", so it must not depend on
  // anything a restart would not fix. An orchestrator kills what fails here.
  app.get(
    '/health/live',
    { schema: { tags: ['health'], summary: 'Process liveness' } },
    async () => ({ status: 'ok' }),
  );

  // Readiness answers "can this instance serve traffic", so it does reach the
  // database. Routing is reported but never fails the check: the service
  // answers every other route without it.
  app.get(
    '/health/ready',
    { schema: { tags: ['health'], summary: 'Readiness, including dependencies' } },
    async () => app.services.health.check(),
  );
};

export default healthRoutes;
