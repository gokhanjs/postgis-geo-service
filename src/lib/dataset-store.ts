import type { ReadStream } from 'node:fs';
import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DatasetIndex {
  latest: string;
  versions: string[];
}

export interface ManifestFile {
  name: string;
  sha256: string;
  bytes: number;
  [extra: string]: unknown;
}

export interface DatasetManifest {
  files: ManifestFile[];
  [extra: string]: unknown;
}

/**
 * Reads published packages from <root>/<name>/index.json and
 * <root>/<name>/<version>/. Callers pass only segments already checked
 * against SAFE_SEGMENT, so no argument here can leave the root.
 */
export class DatasetStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async names(): Promise<string[]> {
    try {
      const entries = await readdir(this.#root, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async index(name: string): Promise<DatasetIndex | null> {
    const index = await readJson(join(this.#root, name, 'index.json'));
    return isIndex(index) ? index : null;
  }

  async manifest(name: string, version: string): Promise<DatasetManifest | null> {
    const manifest = await readJson(join(this.#root, name, version, 'manifest.json'));
    return isManifest(manifest) ? manifest : null;
  }

  /** Opened before anything is sent: once the descriptor is held, pruning cannot cut the body short. */
  async open(
    name: string,
    version: string,
    file: string,
  ): Promise<{ size: number; stream: ReadStream } | null> {
    let handle;
    try {
      handle = await open(join(this.#root, name, version, file), 'r');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return null;
    }
    return { size: stats.size, stream: handle.createReadStream() };
  }
}

/** One path segment: no separator, and no leading dot, so neither ".." nor a staging directory. */
export const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// A corrupt package reads as absent, so it answers 404 instead of failing the whole listing.
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (isMissing(err) || err instanceof SyntaxError) return null;
    throw err;
  }
}

function isIndex(value: unknown): value is DatasetIndex {
  const index = value as Partial<DatasetIndex> | null;
  return (
    typeof index?.latest === 'string' &&
    Array.isArray(index.versions) &&
    index.versions.every((v) => typeof v === 'string')
  );
}

function isManifest(value: unknown): value is DatasetManifest {
  const files = (value as Partial<DatasetManifest> | null)?.files;
  return (
    Array.isArray(files) &&
    files.every((f) => typeof f?.name === 'string' && typeof f.sha256 === 'string')
  );
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}
