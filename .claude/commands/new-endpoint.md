---
description: Scaffold an endpoint across every layer, with a test
argument-hint: [method and path, e.g. "GET /api/v1/entities/{type}/history"]
---

Add the endpoint described in $ARGUMENTS, following the layering in AGENTS.md.

Read an existing vertical slice first (`src/routes/geofences.ts` through
`src/services/geofence.service.ts` to `src/repositories/geofence.repository.ts`)
and match it rather than inventing a shape.

Produce, in this order:

1. **Schema** in `src/schemas/index.ts`: TypeBox, `additionalProperties: false`,
   a `description` on each field. This is also the OpenAPI documentation.
2. **Repository** method: the only place SQL may appear. It takes a tenant id
   and runs inside `withTenant`. Write the tenant predicate explicitly even
   though row-level security would also catch its absence.
3. **Service** method: business logic and cache handling. It must not import
   `pg` or reference HTTP.
4. **Route**: request to service call, a `tags` and `summary` in the schema,
   and `problems.*` for failures.
5. **Integration test** in `test/integration/`, driving real HTTP against real
   PostGIS, including a case proving another tenant cannot reach the data.

Then run `pnpm typecheck && pnpm lint && pnpm test` and show the output. If the
endpoint reads a set of rows, confirm it has a bound on result size.
