import type { Pool } from 'pg';

export interface TenantContext {
  tenant_id: number;
  project_name: string;
}

export interface ApiKeyRecord extends TenantContext {
  key_prefix: string;
  is_active: boolean;
  created_at: string;
}

export class CredentialRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findTenantByKeyHash(keyHash: string): Promise<TenantContext | null> {
    const { rows } = await this.#pool.query<TenantContext>(
      'SELECT tenant_id, project_name FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash],
    );
    return rows[0] ?? null;
  }

  async adminTokenExists(tokenHash: string): Promise<boolean> {
    const { rows } = await this.#pool.query('SELECT 1 FROM admin_tokens WHERE token_hash = $1', [
      tokenHash,
    ]);
    return rows.length > 0;
  }

  async insertApiKey(
    keyHash: string,
    keyPrefix: string,
    tenantId: number,
    projectName: string,
  ): Promise<void> {
    await this.#pool.query(
      'INSERT INTO api_keys (key_hash, key_prefix, tenant_id, project_name) VALUES ($1, $2, $3, $4)',
      [keyHash, keyPrefix, tenantId, projectName],
    );
  }

  async listApiKeys(): Promise<ApiKeyRecord[]> {
    const { rows } = await this.#pool.query<ApiKeyRecord>(
      `SELECT key_prefix, tenant_id, project_name, is_active,
              to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS created_at
       FROM api_keys ORDER BY created_at DESC`,
    );
    return rows;
  }

  /** Returns the revoked key's hash, or null when the prefix matched nothing. */
  async revokeByPrefix(keyPrefix: string): Promise<string | null> {
    const { rows } = await this.#pool.query<{ key_hash: string }>(
      'UPDATE api_keys SET is_active = false WHERE key_prefix = $1 RETURNING key_hash',
      [keyPrefix],
    );
    return rows[0]?.key_hash ?? null;
  }
}
