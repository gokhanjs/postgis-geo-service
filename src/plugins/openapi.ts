import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';

/**
 * Generates the spec from the schemas the routes already validate against, so
 * documentation cannot drift from behaviour the way a hand-written file does.
 */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'PostGIS Geo Service',
          description:
            'Multi-tenant geospatial service for proximity search, geofencing and road routing.',
          version: '1.0.0',
          license: { name: 'MIT', identifier: 'MIT' },
        },
        tags: [
          { name: 'entities', description: 'Point locations and proximity search.' },
          { name: 'geofences', description: 'Service-area polygons and containment.' },
          { name: 'routing', description: 'Road distance and duration via OSRM.' },
          { name: 'admin', description: 'API key issuance and revocation.' },
          { name: 'health', description: 'Liveness and readiness.' },
        ],
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
            adminToken: { type: 'apiKey', name: 'x-admin-token', in: 'header' },
          },
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  },
  { name: 'openapi' },
);
