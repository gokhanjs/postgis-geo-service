import 'dotenv/config';

const REQUIRED = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'] as const;

function requireEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

requireEnv();

function parseList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * How many proxies sit in front of the service.
 *
 * A boolean `true` would trust the whole X-Forwarded-For chain, and the common
 * nginx setup appends rather than overwrites, so a client could put any address
 * at the head of the list and walk past both the allowlist and the rate limit.
 * A hop count makes only the proxies we actually run authoritative.
 */
function parseTrustProxy(
  raw: string | undefined,
): false | ((addr: string, hop: number) => boolean) {
  if (raw === undefined) return false;

  const hops = Number.parseInt(raw, 10);
  if (!Number.isInteger(hops) || hops <= 0) return false;

  return (_addr, hop) => hop < hops;
}

export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),

  database: {
    host: process.env.DB_HOST as string,
    port: Number.parseInt(process.env.DB_PORT as string, 10),
    user: process.env.DB_USER as string,
    password: process.env.DB_PASS ?? '',
    database: process.env.DB_NAME as string,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },

  /** Absent or empty means routing is disabled; compose passes through empty. */
  osrmUrl: process.env.OSRM_URL || null,

  /** Absent means no network restriction. */
  allowedIps: (() => {
    const ips = parseList(process.env.ALLOWED_IPS);
    return ips === null ? null : new Set(ips);
  })(),

  /** Absent disables cross-origin requests, which is right for a service API. */
  corsOrigins: parseList(process.env.CORS_ORIGINS),

  trustProxy: parseTrustProxy(process.env.TRUST_PROXY_HOPS),

  /** Fastify's own default is 1 MB; a polygon body has no business exceeding this. */
  bodyLimit: Number.parseInt(process.env.BODY_LIMIT_BYTES ?? '262144', 10),

  rateLimit: {
    max: Number.parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    /** Per address, deliberately far looser: it sheds unauthenticated abuse only. */
    ipMax: Number.parseInt(process.env.RATE_LIMIT_IP_MAX ?? '1000', 10),
    timeWindow: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  },

  cache: {
    max: 500,
    ttl: 5 * 60 * 1000,
  },
} as const;

export type Config = typeof config;
