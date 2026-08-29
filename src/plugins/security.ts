import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { config } from '../config/index.ts';

/**
 * Security headers, request rate limiting and the optional IP allowlist.
 */
export default fp(
  async (app) => {
    await app.register(helmet);

    await app.register(rateLimit, {
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.timeWindow,
      errorResponseBuilder: () => ({ error: 'Too many requests' }),
    });

    const allowed = config.allowedIps;
    if (allowed === null) return;

    app.addHook('onRequest', async (request, reply) => {
      if (!allowed.has(request.ip)) {
        app.log.warn({ clientIp: request.ip }, 'Rejected by IP allowlist');
        return reply.code(403).send({ error: 'Forbidden' });
      }
    });

    app.log.info(`IP allowlist active: ${[...allowed].join(', ')}`);
  },
  { name: 'security' },
);
