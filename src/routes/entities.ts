import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { EntitySyncBody, NearbyQuery } from '../schemas/index.ts';

const entityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/v1/entities/sync',
    { preHandler: [app.authenticateApiKey], schema: { body: EntitySyncBody } },
    async (request) => {
      const { entity_id, entity_type, lat, lng, is_active } = request.body;

      await app.services.entities.syncLocation({
        entityId: entity_id,
        entityType: entity_type,
        tenantId: request.tenant.tenant_id,
        lat,
        lng,
        isActive: is_active,
      });

      return { success: true };
    },
  );

  app.get(
    '/api/v1/entities/nearby',
    { preHandler: [app.authenticateApiKey], schema: { querystring: NearbyQuery } },
    async (request) => {
      const { lat, lng, entity_type, radius_km } = request.query;

      return app.services.entities.findNearby({
        tenantId: request.tenant.tenant_id,
        entityType: entity_type,
        lat,
        lng,
        radiusKm: radius_km,
      });
    },
  );
};

export default entityRoutes;
