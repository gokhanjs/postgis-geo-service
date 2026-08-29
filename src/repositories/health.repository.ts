import type { Pool } from 'pg';

export class HealthRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** Round-trips a trivial query to prove the pool can still reach the database. */
  async ping(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }
}
