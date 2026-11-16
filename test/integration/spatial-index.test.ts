import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { adminPoolConfig, appPoolConfig } from '../helpers/env.js';

/**
 * Plans the spatial predicates as the service's own role, with a tenant set,
 * because that is the only path on which the planner may refuse the index.
 */

const ENTITIES = 'tenant_entity_locations';
const GEOFENCES = 'tenant_geofences';

let admin: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  admin = new pg.Pool(adminPoolConfig);
  app = new pg.Pool(appPoolConfig);
});

afterAll(async () => {
  await admin?.end();
  await app?.end();
});

beforeEach(async () => {
  await admin.query('TRUNCATE entity_locations, geofences');
  await admin.query(
    `INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location)
     VALUES ('a1', 'site', 1, ST_Point(29.0, 41.0, 4326)::geography)`,
  );
  await admin.query(
    `INSERT INTO geofences (external_id, entity_id, entity_type, tenant_id, area)
     VALUES (1, 'a1', 'site', 1,
             ST_MakeEnvelope(28.9, 40.9, 29.1, 41.1, 4326)::geography)`,
  );
});

interface PlanNode {
  'Index Cond'?: string;
  Plans?: PlanNode[];
}

function indexConditions(node: PlanNode): string[] {
  const own = node['Index Cond'] ? [node['Index Cond']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(indexConditions)];
}

/** Sequential scans are disabled so a handful of rows still yields an index plan. */
async function planAsTenant(sql: string, params: unknown[]): Promise<string[]> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', '1', true)");
    await client.query('SET LOCAL enable_seqscan = off');
    const { rows } = await client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) ${sql}`,
      params,
    );
    await client.query('COMMIT');
    return indexConditions(rows[0]!['QUERY PLAN'][0].Plan);
  } finally {
    client.release();
  }
}

describe('spatial index under tenant isolation', () => {
  it('narrows proximity search by location inside the index', async () => {
    const conditions = await planAsTenant(
      `SELECT entity_id FROM ${ENTITIES}
       WHERE is_active AND entity_type = $1 AND tenant_id = $2
         AND ST_DWithin(location, $3::geography, $4)`,
      ['site', 1, 'SRID=4326;POINT(29 41)', 1000],
    );
    expect(conditions).toContainEqual(expect.stringContaining('location &&'));
  });

  it('narrows containment search by area inside the index', async () => {
    const conditions = await planAsTenant(
      `SELECT entity_id FROM ${GEOFENCES}
       WHERE is_active AND entity_type = $1 AND tenant_id = $2
         AND ST_Covers(area, $3::geography)`,
      ['site', 1, 'SRID=4326;POINT(29 41)'],
    );
    expect(conditions).toContainEqual(expect.stringContaining('area &&'));
  });
});
