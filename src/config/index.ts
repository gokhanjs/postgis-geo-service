import 'dotenv/config';

/**
 * Reads and validates the environment once, at import time, so a
 * misconfiguration fails at startup rather than on the first request that
 * happens to need the missing value.
 */

const REQUIRED = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'] as const;

function requireEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

requireEnv();

function parseAllowedIps(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const ips = raw
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  return ips.length > 0 ? new Set(ips) : null;
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

  /** Absent means routing is disabled and /routing answers 503. */
  osrmUrl: process.env.OSRM_URL ?? null,

  /** Absent means no network restriction. */
  allowedIps: parseAllowedIps(process.env.ALLOWED_IPS),

  trustProxy: process.env.TRUST_PROXY === 'true',

  rateLimit: {
    max: 100,
    timeWindow: 60_000,
  },

  cache: {
    max: 500,
    ttl: 5 * 60 * 1000,
  },
} as const;

export type Config = typeof config;
