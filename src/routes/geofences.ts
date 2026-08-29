import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import { ContainingQuery, GeofenceBody, GeofencePathParams } from '../schemas/index.ts';

const geofenceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.put(
    '/api/v1/geofences/:id',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['geofences'],
        summary: 'Create or replace one geofence',
        description: 'The identifier is the caller’s own and is unique within its tenant.',
        params: GeofencePathParams,
        body: GeofenceBody,
      },
    },
    async (request) => {
      const { id } = request.params;
      const { entity_id, entity_type, area, is_active } = request.body;

      const rejection = await app.services.geofences.sync({
        externalId: id,
        entityId: entity_id,
        entityType: entity_type,
        tenantId: request.tenant.tenant_id,
        area,
        isActive: is_active,
      });

      if (rejection !== null) throw problems.invalidGeometry(rejection);

      return { id, entity_id, entity_type };
    },
  );

  app.delete(
    '/api/v1/geofences/:id',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['geofences'],
        summary: 'Delete one geofence',
        params: GeofencePathParams,
      },
    },
    async (request, reply) => {
      const deleted = await app.services.geofences.delete(
        request.params.id,
        request.tenant.tenant_id,
      );
      if (!deleted) throw problems.notFound('Geofence');

      return reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/geofences/containing',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['geofences'],
        summary: 'Find the geofences covering a point',
        description:
          'Naming an entity answers whether that one covers the point; omitting it lists every entity of the type that does.',
        querystring: ContainingQuery,
      },
    },
    async (request) => {
      const { lat, lng, entity_type, entity_id } = request.query;
      const tenantId = request.tenant.tenant_id;

      if (entity_id !== undefined) {
        return app.services.geofences.isInside(tenantId, entity_type, entity_id, lng, lat);
      }

      return {
        results: await app.services.geofences.findCovering(tenantId, entity_type, lng, lat),
      };
    },
  );
};

export default geofenceRoutes;
