import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stagingDir } from './export.ts';

const KEEP_VERSIONS = 3;

/**
 * Moves a staged version into place, then points the index at it. Both steps
 * are renames, so a reader sees the old release or the new one, never a mix.
 */
export async function publish(root: string, name: string, version: string): Promise<void> {
  const packageDir = join(root, name);
  await rename(stagingDir(root, name, version), join(packageDir, version));

  const previous = await readIndex(packageDir);
  // Version names are UTC timestamps, so the lexical order is the age order.
  const versions = [...new Set([version, ...previous])].sort().reverse().slice(0, KEEP_VERSIONS);

  const tmp = join(packageDir, '.index.json.tmp');
  await writeFile(tmp, `${JSON.stringify({ latest: version, versions }, null, 2)}\n`);
  await rename(tmp, join(packageDir, 'index.json'));

  for (const entry of await readdir(packageDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !versions.includes(entry.name)) {
      await rm(join(packageDir, entry.name), { recursive: true, force: true });
    }
  }
}

/** Removes what an interrupted run left behind. */
export async function clearStaging(root: string, name: string): Promise<void> {
  const packageDir = join(root, name);
  let entries;
  try {
    entries = await readdir(packageDir);
  } catch {
    return;
  }
  for (const entry of entries.filter((e) => e.startsWith('.staging-'))) {
    await rm(join(packageDir, entry), { recursive: true, force: true });
  }
}

async function readIndex(packageDir: string): Promise<string[]> {
  try {
    const index = JSON.parse(await readFile(join(packageDir, 'index.json'), 'utf8')) as {
      versions: string[];
    };
    return index.versions;
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return [];
    throw err;
  }
}
