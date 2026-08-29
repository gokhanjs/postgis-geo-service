import type { CollectionRepository } from '../repositories/collection.repository.ts';

export class CollectionService {
  readonly #collections: CollectionRepository;

  constructor(collections: CollectionRepository) {
    this.#collections = collections;
  }

  /** Returns the collection body, or null when the link is spent or expired. */
  download(token: string): Promise<string | null> {
    return this.#collections.consumeToken(token);
  }

  purgeExpired(): Promise<number> {
    return this.#collections.deleteExpired();
  }
}
