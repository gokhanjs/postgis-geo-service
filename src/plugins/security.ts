import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { config } from '../config/index.ts';
import { PROBLEM_CONTENT_TYPE, problems } from '../lib/problem.ts';

export default fp(
  async (app) => {
    await app.register(helmet);
    await app.register(cors, {
      origin: config.corsOrigins ?? false,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['content-type', 'x-api-key', 'x-admin-token'],
      maxAge: 86_400,
    });

    await app.register(rateLimit, {
      max: config.rateLimit.ipMax,
      timeWindow: config.rateLimit.timeWindow,
      // Quota belongs to the credential, not the address: many tenants behind
      // one gateway would otherwise share a budget, and one tenant spread over
      // many addresses would escape it entirely.
      // By address: the unvalidated x-api-key header could simply be rotated.
      keyGenerator: (request: FastifyRequest) => request.ip,
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
