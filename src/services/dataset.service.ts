import type { ReadStream } from 'node:fs';
import {
  SAFE_SEGMENT,
  type DatasetManifest,
  type DatasetStore,
  type ManifestFile,
} from '../lib/dataset-store.ts';

export interface DatasetListing {
  name: string;
  latest: string;
  versions: string[];
}

export interface DatasetFile {
  sha256: string;
  /** False when reached through "latest", which moves with every release. */
  immutable: boolean;
  /** Null when the listed file is gone, as after pruning. */
  open: () => Promise<{ size: number; stream: ReadStream } | null>;
}

const LATEST = 'latest';

/**
 * Serves only what a package's index and manifest list: a file that merely
 * sits in the directory, or a version not yet indexed, does not exist here.
 */
export class DatasetService {
  readonly #store: DatasetStore | null;

  constructor(store: DatasetStore | null) {
    this.#store = store;
  }

  async list(): Promise<DatasetListing[]> {
    if (this.#store === null) return [];
    const listings: DatasetListing[] = [];
    for (const name of (await this.#store.names()).filter((n) => SAFE_SEGMENT.test(n)).sort()) {
      const index = await this.#store.index(name);
      if (index !== null) listings.push({ name, latest: index.latest, versions: index.versions });
    }
    return listings;
  }

  async manifest(name: string, version: string): Promise<DatasetManifest | null> {
    const resolved = await this.#resolve(name, version);
    return resolved === null ? null : resolved.manifest;
  }

  async file(name: string, version: string, file: string): Promise<DatasetFile | null> {
    const resolved = await this.#resolve(name, version);
    if (resolved === null || this.#store === null) return null;

    const listed: ManifestFile | undefined = resolved.manifest.files.find((f) => f.name === file);
    if (listed === undefined || !SAFE_SEGMENT.test(listed.name)) return null;

    const store = this.#store;
    return {
      sha256: listed.sha256,
      immutable: version !== LATEST,
      open: () => store.open(name, resolved.version, listed.name),
    };
  }

  async #resolve(
    name: string,
    version: string,
  ): Promise<{ version: string; manifest: DatasetManifest } | null> {
    if (this.#store === null || !SAFE_SEGMENT.test(name) || !SAFE_SEGMENT.test(version)) {
      return null;
    }
    const index = await this.#store.index(name);
    if (index === null) return null;

    const concrete = version === LATEST ? index.latest : version;
    if (!index.versions.includes(concrete) || !SAFE_SEGMENT.test(concrete)) return null;

    const manifest = await this.#store.manifest(name, concrete);
    return manifest === null ? null : { version: concrete, manifest };
  }
}
