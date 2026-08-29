import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ZoneCheckQuery, ZoneIdParams, ZoneSyncBody } from '../schemas/index.ts';

const zoneRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/zones/sync',
    { preHandler: [app.authenticateApiKey], schema: { body: ZoneSyncBody } },
    async (request, reply) => {
      const { id, entity_id, entity_type, geojson, is_active } = request.body;

      const rejection = await app.services.zones.sync({
        id,
        entityId: entity_id,
        entityType: entity_type,
        tenantId: request.tenant.tenant_id,
        geojson,
        isActive: is_active,
      });

      if (rejection !== null) return reply.code(400).send({ error: rejection });

      return { success: true };
    },
  );

  app.delete(
    '/api/v1/zones/:id',
    { preHandler: [app.authenticateApiKey], schema: { params: ZoneIdParams } },
    async (request, reply) => {
      const deleted = await app.services.zones.delete(request.params.id, request.tenant.tenant_id);

      if (!deleted) return reply.code(404).send({ error: 'Zone not found' });

      return { success: true };
    },
  );

  app.get(
    '/api/v1/zones/check',
    { preHandler: [app.authenticateApiKey], schema: { querystring: ZoneCheckQuery } },
    async (request) => {
      const { lat, lng, entity_type, entity_id } = request.query;
      const tenantId = request.tenant.tenant_id;

      // With an entity named, the caller is asking about that one zone;
      // without, about every zone of that type covering the point.
      if (entity_id !== undefined) {
        return app.services.zones.isInside(tenantId, entity_type, entity_id, lng, lat);
      }

      return app.services.zones.findCovering(tenantId, entity_type, lng, lat);
    },
  );
};

export default zoneRoutes;
