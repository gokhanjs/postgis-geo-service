import { LRUCache } from 'lru-cache';
import {
  digestsMatch,
  generateApiKey,
  hashCredential,
  KEY_PREFIX_LENGTH,
} from '../lib/credentials.ts';
import type {
  ApiKeyRecord,
  CredentialRepository,
  TenantContext,
} from '../repositories/credential.repository.ts';

const CACHE_TTL_MS = 60 * 1000;

export interface IssuedKey {
  key: string;
  tenant_id: number;
  project_name: string;
}

export class CredentialService {
  readonly #credentials: CredentialRepository;

  // Keyed by digest, never by the secret itself, so the plaintext key exists
  // only for the length of the request that presented it.
  readonly #tenantByHash = new LRUCache<string, TenantContext>({ max: 200, ttl: CACHE_TTL_MS });
  readonly #adminHashes = new LRUCache<string, true>({ max: 10, ttl: CACHE_TTL_MS });

  constructor(credentials: CredentialRepository) {
    this.#credentials = credentials;
  }

  async resolveTenant(key: string): Promise<TenantContext | null> {
    const hash = hashCredential(key);

    const cached = this.#tenantByHash.get(hash);
    if (cached !== undefined) return cached;

    const context = await this.#credentials.findTenantByKeyHash(hash);
    if (context === null) return null;

    this.#tenantByHash.set(hash, context);
    return context;
  }

  async isValidAdminToken(token: string): Promise<boolean> {
    const hash = hashCredential(token);
    if (this.#adminHashes.has(hash)) return true;

    const stored = await this.#credentials.findAdminTokenHash(hash);
    if (stored === null || !digestsMatch(stored, hash)) return false;

    this.#adminHashes.set(hash, true);
    return true;
  }

  async issueApiKey(tenantId: number, projectName: string): Promise<IssuedKey> {
    const issued = generateApiKey();
    await this.#credentials.insertApiKey(issued.hash, issued.prefix, tenantId, projectName);

    return { key: issued.key, tenant_id: tenantId, project_name: projectName };
  }

  listApiKeys(): Promise<ApiKeyRecord[]> {
    return this.#credentials.listApiKeys();
  }

  /** Revocation is by prefix, since the full key is no longer recoverable. */
  async revokeApiKey(keyPrefix: string): Promise<boolean> {
    const hash = await this.#credentials.revokeByPrefix(keyPrefix.slice(0, KEY_PREFIX_LENGTH));
    if (hash === null) return false;

    this.#tenantByHash.delete(hash);
    return true;
  }
}
