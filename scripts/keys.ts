import 'dotenv/config';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { CredentialRepository } from '../src/repositories/credential.repository.ts';
import { CredentialService } from '../src/services/credential.service.ts';

const USAGE = `Usage:
  keys issue --tenant <id> --project <name>   issue a key and print it once
  keys list                                   list keys by prefix
  keys revoke <prefix>                        revoke a key by its prefix`;

// tenant_id is an INT column.
const MAX_TENANT_ID = 2_147_483_647;
const TENANT_ID = /^[1-9][0-9]{0,9}$/;
const PROJECT_NAME = /^[\x20-\x7E]{1,200}$/;
// Never the full key: whatever is typed here stays in the operator's shell history.
const KEY_PREFIX = /^gsk_[0-9a-f]{1,8}$/;

/**
 * Manages API keys outside the service, as the owner role. The runtime role may
 * only read keys, so this is the one way to create or revoke them.
 */
async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { tenant: { type: 'string' }, project: { type: 'string' } },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { positionals, values } = parsed;
  const [command, ...rest] = positionals;

  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.MIGRATION_DB_USER ?? process.env.DB_USER,
    password: process.env.MIGRATION_DB_PASS ?? process.env.DB_PASS ?? '',
    database: process.env.DB_NAME,
  });
  const credentials = new CredentialService(new CredentialRepository(pool));

  try {
    switch (command) {
      case 'issue': {
        const tenantId = TENANT_ID.test(values.tenant ?? '') ? Number(values.tenant) : Number.NaN;
        const project = values.project?.trim() ?? '';
        if (!(tenantId <= MAX_TENANT_ID)) {
          throw new UsageError(`issue needs --tenant between 1 and ${MAX_TENANT_ID}`);
        }
        if (!PROJECT_NAME.test(project)) {
          throw new UsageError('issue needs --project of 1-200 printable ASCII characters');
        }
        const { key } = await credentials.issueApiKey(tenantId, project);
        console.log(
          `\nKey for tenant ${tenantId} (${project}). Store it now, it will not be shown again:\n`,
        );
        console.log(`  ${key}\n`);
        break;
      }
      case 'list': {
        const keys = await credentials.listApiKeys();
        console.table(
          keys.map((k) => ({
            prefix: k.key_prefix,
            tenant: k.tenant_id,
            project: k.project_name,
            active: k.is_active,
            created: k.created_at,
          })),
        );
        break;
      }
      case 'revoke': {
        const [prefix] = rest;
        if (prefix === undefined || !KEY_PREFIX.test(prefix)) {
          throw new UsageError('revoke needs the key prefix shown by list, e.g. gsk_1a2b3c4d');
        }
        if (!(await credentials.revokeApiKey(prefix))) {
          throw new Error(`No key with prefix ${prefix}`);
        }
        console.log(`Revoked ${prefix}. A running service may accept it for up to a minute.`);
        break;
      }
      default:
        throw new UsageError(
          command === undefined ? 'no command given' : `unknown command ${command}`,
        );
    }
  } finally {
    await pool.end();
  }
}

class UsageError extends Error {}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof UsageError) console.error(`\n${USAGE}`);
  process.exitCode = 1;
}
