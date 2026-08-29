import type { Pool } from 'pg';

export interface TenantContext {
  tenant_id: number;
  project_name: string;
}

export interface ApiKeyRecord extends TenantContext {
  key: string;
  is_active: boolean;
  created_at: Date;
}

export class CredentialRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findTenantByApiKey(key: string): Promise<TenantContext | null> {
    const { rows } = await this.#pool.query<TenantContext>(
      'SELECT tenant_id, project_name FROM api_keys WHERE key = $1 AND is_active = true',
      [key],
    );
    return rows[0] ?? null;
  }

  async adminTokenExists(token: string): Promise<boolean> {
    const { rows } = await this.#pool.query('SELECT token FROM admin_tokens WHERE token = $1', [
      token,
    ]);
    return rows.length > 0;
  }

  async insertApiKey(key: string, tenantId: number, projectName: string): Promise<void> {
    await this.#pool.query(
      'INSERT INTO api_keys (key, tenant_id, project_name) VALUES ($1, $2, $3)',
      [key, tenantId, projectName],
    );
  }

  async listApiKeys(): Promise<ApiKeyRecord[]> {
    const { rows } = await this.#pool.query<ApiKeyRecord>(
      'SELECT key, tenant_id, project_name, is_active, created_at FROM api_keys ORDER BY created_at DESC',
    );
    return rows;
  }

  /** Returns false when no such key existed. */
  async revokeApiKey(key: string): Promise<boolean> {
    const { rows } = await this.#pool.query(
      'UPDATE api_keys SET is_active = false WHERE key = $1 RETURNING key',
      [key],
    );
    return rows.length > 0;
  }
}
