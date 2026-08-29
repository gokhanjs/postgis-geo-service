import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  apiKeySecurity,
  EntityAck,
  EntityBody,
  EntityPathParams,
  guardedResponses,
  NearbyQuery,
  NearbyResponse,
} from '../schemas/index.ts';

const entityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.put(
    '/api/v1/entities/:type/:id',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['entities'],
        summary: 'Create or replace the location of one entity',
        security: apiKeySecurity,
        params: EntityPathParams,
        body: EntityBody,
        response: { 200: EntityAck, ...guardedResponses },
      },
    },
    async (request) => {
      const { type, id } = request.params;
      const { lat, lng, is_active } = request.body;

      await app.services.entities.syncLocation({
        entityId: id,
        entityType: type,
        tenantId: request.tenant.tenant_id,
        lat,
        lng,
        isActive: is_active,
      });

      return { entity_id: id, entity_type: type };
    },
  );

  app.get(
    '/api/v1/entities/nearby',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['entities'],
        summary: 'Find entities of one type within a radius, nearest first',
        security: apiKeySecurity,
        querystring: NearbyQuery,
        response: { 200: NearbyResponse, ...guardedResponses },
      },
    },
    async (request) => {
      const { lat, lng, entity_type, radius_km, limit, cursor } = request.query;

      return app.services.entities.findNearby({
        tenantId: request.tenant.tenant_id,
        entityType: entity_type,
        lat,
        lng,
        radiusKm: radius_km,
        limit,
        cursor,
      });
    },
  );
};

export default entityRoutes;
