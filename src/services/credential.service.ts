import { randomBytes } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type {
  ApiKeyRecord,
  CredentialRepository,
  TenantContext,
} from '../repositories/credential.repository.ts';

const API_KEY_BYTES = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;

export class CredentialService {
  readonly #credentials: CredentialRepository;
  readonly #tenantByKey = new LRUCache<string, TenantContext>({ max: 200, ttl: CACHE_TTL_MS });
  readonly #adminTokens = new LRUCache<string, true>({ max: 10, ttl: CACHE_TTL_MS });

  constructor(credentials: CredentialRepository) {
    this.#credentials = credentials;
  }

  async resolveTenant(key: string): Promise<TenantContext | null> {
    const cached = this.#tenantByKey.get(key);
    if (cached !== undefined) return cached;

    const context = await this.#credentials.findTenantByApiKey(key);
    if (context === null) return null;

    this.#tenantByKey.set(key, context);
    return context;
  }

  async isValidAdminToken(token: string): Promise<boolean> {
    if (this.#adminTokens.has(token)) return true;

    const exists = await this.#credentials.adminTokenExists(token);
    if (exists) this.#adminTokens.set(token, true);
    return exists;
  }

  async issueApiKey(tenantId: number, projectName: string): Promise<string> {
    const key = `gsk_${randomBytes(API_KEY_BYTES).toString('hex')}`;
    await this.#credentials.insertApiKey(key, tenantId, projectName);
    return key;
  }

  listApiKeys(): Promise<ApiKeyRecord[]> {
    return this.#credentials.listApiKeys();
  }

  async revokeApiKey(key: string): Promise<boolean> {
    const revoked = await this.#credentials.revokeApiKey(key);
    if (revoked) this.#tenantByKey.delete(key);
    return revoked;
  }
}
