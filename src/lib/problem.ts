/**
 * RFC 9457 problem details. `type` is a stable identifier a client can branch
 * on, which a human-readable message is not.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// A URN, not a URL: an identifier that cannot rot beats a link that must live.
const BASE = 'urn:geo-service:problem';

export class HttpProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;

  constructor(status: number, type: string, title: string, detail?: string) {
    super(detail ?? title);
    this.name = 'HttpProblem';
    this.status = status;
    this.type = `${BASE}:${type}`;
    this.title = title;
  }
}

export const problems = {
  missingApiKey: () =>
    new HttpProblem(401, 'missing-api-key', 'Missing API key', 'Send the key in x-api-key.'),

  invalidApiKey: () => new HttpProblem(401, 'invalid-api-key', 'Invalid or inactive API key'),

  missingAdminToken: () =>
    new HttpProblem(
      401,
      'missing-admin-token',
      'Missing admin token',
      'Send the token in x-admin-token.',
    ),

  invalidAdminToken: () => new HttpProblem(401, 'invalid-admin-token', 'Invalid admin token'),

  forbiddenAddress: () =>
    new HttpProblem(403, 'address-not-allowed', 'Address not allowed by the server policy'),

  invalidGeometry: (detail: string) =>
    new HttpProblem(400, 'invalid-geometry', 'Invalid geometry', detail),

  notFound: (what: string) => new HttpProblem(404, 'not-found', `${what} not found`),

  routingDisabled: () =>
    new HttpProblem(
      503,
      'routing-disabled',
      'Routing is not configured',
      'Set OSRM_URL to enable road distance and duration.',
    ),

  routingUnreachable: () =>
    new HttpProblem(503, 'routing-unreachable', 'Routing service unreachable'),

  tooManyRequests: () => new HttpProblem(429, 'rate-limit-exceeded', 'Too many requests'),
} as const;
