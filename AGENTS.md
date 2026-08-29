# AGENTS.md

Instructions for coding agents working in this repository.

Every rule below is a defect this project has already had, so none are style
preferences. Three are checked mechanically and marked **[enforced]**; the rest
rely on you.

## Architecture invariants

**SQL lives only in `src/repositories/`.** [enforced] Routes map HTTP to a service call;
services hold business logic and know neither HTTP nor SQL. ESLint rejects a
`pg` import from `src/routes` or `src/services`.

**Every repository method takes a tenant id and runs inside `withTenant`.**
Row-level security is the backstop, not the primary guard: write the tenant
predicate _and_ rely on the policy. A method that skips `withTenant` will read
zero rows, because the policy has no tenant to match.

**Never cast the indexed column.** [enforced] Columns are `geography`; casting a
parameter (`$1::geography`) is fine and necessary, but casting the column
inside a predicate (`location::geography`) makes it an expression that no GiST
index can serve, so the index silently stops being used.

**Use `ST_Covers`, not `ST_Contains`.** [enforced] `ST_Contains` excludes the boundary, so
a point on an edge shared by two adjacent areas belongs to neither.

**Filter and report with the same earth model.** `ST_DWithin` on geography
measures on the spheroid; pairing it with `ST_DistanceSphere` makes the
reported distance disagree with the filter that admitted the row.

**Composite GiST indexes lead with the geography column.** With the scalar
columns first, whether the spatial predicate reaches the index depends on the
planner's row estimates, and on some distributions it does not.

## Adding an endpoint

1. A TypeBox schema in `src/schemas/`. It is both the validation and the
   OpenAPI documentation, so an undocumented endpoint is an unvalidated one.
2. A route in `src/routes/` that only maps request to service call.
3. Service and repository methods as needed.
4. An integration test that fails without the change.

Raise `problems.*` from `src/lib/problem.ts` rather than building an error
body. Every failure is RFC 9457 problem details.

## Changing the schema

Numbered `.do`/`.undo` pairs in `migrations/`. There is no production data, so
correcting an unreleased migration in place is preferred over stacking a fix on
top; re-apply with `docker compose down -v`.

Bound any client-supplied integer to `Number.MAX_SAFE_INTEGER`. `JSON.parse`
collapses larger values onto the same double before validation runs, so two
distinct identifiers can silently become one.

Verify index behaviour with `EXPLAIN (ANALYZE)` against realistic row counts.
An index appearing in `\d` is not evidence it is used.

## Verifying

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Tests run against real PostGIS. Do not introduce mocks for spatial behaviour: a
mock of `ST_Covers` asserts only that it was written to agree with the test.

Claiming something works requires having run it. `docker compose down -v`
before a final check, because several defects here were only visible on a clean
database.

## Comments

Default to none. Write one only for a constraint, a workaround, or a decision
whose reasoning is not visible in the code. Never narrate what the code does,
and never record history in a comment; that belongs in the commit message.
Two lines maximum.

## Commits

Conventional Commits, English, imperative subject. The body explains why the
change is right and what would break without it. No agent attribution.
