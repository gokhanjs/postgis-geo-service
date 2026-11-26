import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { config } from '../config/index.ts';
import { PROBLEM_CONTENT_TYPE, problems } from '../lib/problem.ts';

export default fp(
  async (app) => {
    await app.register(helmet);
    await app.register(cors, {
      origin: config.corsOrigins ?? false,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['content-type', 'x-api-key'],
      maxAge: 86_400,
    });

    await app.register(rateLimit, {
      max: config.rateLimit.ipMax,
      timeWindow: config.rateLimit.timeWindow,
      // The default key is the address with each IPv6 /64 folded into one;
      // never the unvalidated x-api-key header, which could simply be rotated.
      errorResponseBuilder: (_request, context) => {
        const problem = problems.tooManyRequests();
        return {
          statusCode: 429,
          type: problem.type,
          title: problem.title,
          status: 429,
          detail: `Limit is ${context.max} requests per ${context.after}.`,
        };
      },
    });

    app.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode === 429) reply.type(PROBLEM_CONTENT_TYPE);
      return payload;
    });

    const allowed = config.allowedIps;
    if (allowed === null) return;

    app.addHook('onRequest', async (request) => {
      if (!allowed.has(request.ip)) {
        app.log.warn({ clientIp: request.ip }, 'Rejected by IP allowlist');
        throw problems.forbiddenAddress();
      }
    });

    app.log.info(`IP allowlist active: ${[...allowed].join(', ')}`);
  },
  { name: 'security' },
);
