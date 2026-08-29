import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { config } from './config/index.ts';
import { buildServices } from './container.ts';
import databasePlugin from './plugins/database.ts';
import authPlugin from './plugins/auth.ts';
import errorHandlerPlugin from './plugins/error-handler.ts';
import openapiPlugin from './plugins/openapi.ts';
import securityPlugin from './plugins/security.ts';
import adminRoutes from './routes/admin.ts';
import entityRoutes from './routes/entities.ts';
import healthRoutes from './routes/health.ts';
import routingRoutes from './routes/routing.ts';
import geofenceRoutes from './routes/geofences.ts';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Assembles the application without binding a port, so tests can drive it
 * in-process and `server.ts` stays responsible only for listening.
 */
export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    // An id the caller can quote back, so one report maps to one log trace.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  app.decorate('services', buildServices(app.pg, config));

  await app.register(openapiPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(adminRoutes);
  await app.register(entityRoutes);
  await app.register(geofenceRoutes);
  await app.register(routingRoutes);

  return app;
}
