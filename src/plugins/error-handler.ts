import fp from 'fastify-plugin';
import { HttpProblem, PROBLEM_CONTENT_TYPE, type Problem } from '../lib/problem.ts';

/**
 * Turns every failure into RFC 9457 problem details.
 *
 * Unrecognised errors are logged in full and answered with a generic body: a
 * raw PostGIS or driver message tells a client about the schema, and tells an
 * attacker rather more.
 */
export default fp(
  async (app) => {
    app.setErrorHandler((error, request, reply) => {
      const problem = toProblem(error, request.url);

      if (problem.status >= 500) {
        request.log.error({ err: error }, 'Request failed');
      } else {
        request.log.info({ err: error, status: problem.status }, 'Request rejected');
      }

      reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
    });

    app.setNotFoundHandler((request, reply) => {
      reply
        .code(404)
        .type(PROBLEM_CONTENT_TYPE)
        .send({
          type: 'about:blank',
          title: 'Route not found',
          status: 404,
          instance: request.url,
        } satisfies Problem);
    });
  },
  { name: 'error-handler' },
);

function isProblemShaped(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['status'] === 'number' && typeof candidate['title'] === 'string';
}

function toProblem(error: unknown, instance: string): Problem {
  // The rate limiter builds its own body, so it arrives already in this shape
  // rather than as an HttpProblem.
  if (!(error instanceof Error) && isProblemShaped(error)) {
    return { ...error, instance };
  }

  if (error instanceof HttpProblem) {
    return {
      type: error.type,
      title: error.title,
      status: error.status,
      ...(error.message !== error.title ? { detail: error.message } : {}),
      instance,
    };
  }

  // Schema rejections arrive from Fastify already carrying a 400 and a message
  // that names the offending field, which is safe and useful to pass through.
  const fastifyError = error as { statusCode?: number; validation?: unknown; message?: string };
  if (fastifyError.validation !== undefined) {
    return {
      type: 'about:blank',
      title: 'Request validation failed',
      status: 400,
      detail: fastifyError.message ?? 'The request did not match the expected schema.',
      instance,
    };
  }

  const status = fastifyError.statusCode ?? 500;
  if (status < 500) {
    return {
      type: 'about:blank',
      title: fastifyError.message ?? 'Request rejected',
      status,
      instance,
    };
  }

  return {
    type: 'about:blank',
    title: 'Internal server error',
    status: 500,
    instance,
  };
}
