import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { migrationEnv } from './env.js';

const run = promisify(execFile);

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the key CLI with the environment the service itself gets: the runtime
 * role in DB_USER, the owner in MIGRATION_DB_USER. The CLI must pick the owner.
 */
export async function runKeysCli(args: string[]): Promise<CliResult> {
  const env = { ...process.env, ...migrationEnv };

  try {
    const { stdout, stderr } = await run('node', ['scripts/keys.ts', ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failed = err as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

export function issuedKeyFrom(stdout: string): string {
  const match = /gsk_[0-9a-f]{48}/.exec(stdout);
  if (match === null) throw new Error(`No key in CLI output:\n${stdout}`);
  return match[0];
}
