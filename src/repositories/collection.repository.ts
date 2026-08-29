import type { Pool } from 'pg';

export class CollectionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Hands out the collection behind a token and burns the token in the same
   * transaction, so a link works exactly once.
   *
   * FOR UPDATE SKIP LOCKED is what makes that hold under concurrency: a second
   * request arriving mid-transaction cannot see the locked row and comes back
   * empty rather than waiting and then serving a second copy.
   */
  async consumeToken(token: string): Promise<string | null> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ collection: string }>(
        `
        SELECT collection
        FROM   collection_tokens
        WHERE  token      = $1
          AND  expires_at > NOW()
        FOR UPDATE SKIP LOCKED
        `,
        [token],
      );

      const collection = rows[0]?.collection;
      if (collection === undefined) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query('DELETE FROM collection_tokens WHERE token = $1', [token]);
      await client.query('COMMIT');
      return collection;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteExpired(): Promise<number> {
    const { rowCount } = await this.#pool.query(
      'DELETE FROM collection_tokens WHERE expires_at < NOW()',
    );
    return rowCount ?? 0;
  }
}
