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
      type: 'urn:geo-service:problem:validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: fastifyError.message ?? 'The request did not match the expected schema.',
      instance,
    };
  }

  const fromDatabase = databaseProblem(error, instance);
  if (fromDatabase !== null) return fromDatabase;

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

// Rules the database enforces are still the caller's mistake.
const SQLSTATE = {
  checkViolation: '23514',
  uniqueViolation: '23505',
  notNullViolation: '23502',
  numericOutOfRange: '22003',
  invalidText: '22P02',
} as const;

function databaseProblem(error: unknown, instance: string): Problem | null {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;

  switch (code) {
    case SQLSTATE.checkViolation: {
      const constraint = (error as { constraint?: string }).constraint;
      const detail =
        constraint === 'geofences_area_valid'
          ? 'The polygon is not valid: it may be self-intersecting.'
          : 'The value violates a constraint on the target table.';
      return { type: 'about:blank', title: 'Invalid geometry', status: 400, detail, instance };
    }
    case SQLSTATE.uniqueViolation:
      return { type: 'about:blank', title: 'Already exists', status: 409, instance };
    case SQLSTATE.notNullViolation:
    case SQLSTATE.numericOutOfRange:
    case SQLSTATE.invalidText:
      return { type: 'about:blank', title: 'Request rejected', status: 400, instance };
    default:
      return null;
  }
}
