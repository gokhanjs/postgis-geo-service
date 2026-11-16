# 6. The service reads tenant data through views

Amends [0002](0002-tenant-isolation-in-the-database.md): isolation still lives
in the database, but the service no longer relies on row-level security to
enforce it.

## Context

Measured as the runtime role, with a tenant set, on 200,000 rows across twenty
tenants, a 1 km proximity search read 4,636 buffers and took 293 ms. The same
query as the migration role read about 300 and took 5 ms. The plan showed why:

```
Bitmap Index Scan on entity_locations_lookup
  Index Cond: ((tenant_id = 3) AND (entity_type = 'driver'::text))
Filter: st_dwithin(location, ...)
Rows Removed by Filter: 9987
```

The GiST index was used, but only on its scalar columns. Every row of the
tenant was fetched and tested against the radius.

Row-level security evaluates a policy before any predicate the query supplies,
and the planner may only move a query predicate into an index condition if the
function behind it is `LEAKPROOF`, meaning it cannot reveal anything about a
row it was not meant to see. `int4eq` and `texteq` are; `ST_DWithin`,
`ST_Covers` and the geography `&&` operator are not. So under the policy the
spatial predicate could never reach the index, for proximity and containment
alike.

## Decision

Each spatial table gets a view that filters on `current_tenant_id()` with
`WITH CASCADED CHECK OPTION`. The runtime role has no privileges on the tables
and full DML on the views; repositories name the views. The row-level security
policies stay on the tables.

## Reasoning

A plain view is inlined into the query, so its tenant filter and the query's
own predicates are planned together, with nothing forcing an order between
them. The spatial predicate reaches the index condition again, and the same
search reads 317 buffers in 3.9 ms.

The guarantee from 0002 is unchanged in the cases it was written for. A query
that omits its tenant predicate still returns nothing, because the view
supplies one. A write into another tenant is refused by the check option rather
than the policy. The runtime role cannot get around either, since it cannot
name the tables at all.

What is given up is leak resistance. A plain view lets the query's own
predicates run on rows the view would discard, so a predicate that can fail on
a row's value can quote that value in its error. A cast is enough:
`WHERE entity_id::int = 1` through the view reports another tenant's
identifier, where the policy returned only the caller's row. The repositories
apply nothing that can raise to a view column except the PostGIS predicates
this change exists for, which run on columns constrained to valid geography.
`AGENTS.md` makes that a rule.

Two alternatives were tried or considered:

- **Marking the PostGIS functions `LEAKPROOF`.** It works, and it is the
  smallest change. It also does not last: PostGIS upgrade scripts redefine
  `ST_DWithin` with `CREATE OR REPLACE FUNCTION`, and that resets the
  attribute. Every extension upgrade would silently restore the slow plan, and
  CI, which builds a fresh database each time, would not notice. It also needs
  a superuser, which managed PostgreSQL usually withholds.
- **`SECURITY DEFINER` functions for the spatial reads.** Correct, but it moves
  the queries out of the repositories into migrations, so every change to a
  query becomes a schema change.

The policies are kept because they cost nothing and still cover any role that
is later granted the tables directly.

## Consequences

`security_barrier` on a view brings the slow plan back without any other
symptom, since it reinstates exactly the ordering the policy imposed. Two
related settings fail differently. `security_invoker` on a view makes the
caller's privileges apply to the table, so the service gets `permission denied`.
`FORCE ROW LEVEL SECURITY` has no effect while the tables belong to a
superuser, but would restore the policy if ownership ever moved to an ordinary
role. `AGENTS.md` lists all three, and an integration test plans both spatial
queries as the runtime role and fails if the spatial predicate leaves the index
condition.

The check option also answers differently from the policy when a write names
another tenant: `ON CONFLICT DO NOTHING` succeeds silently if that tenant holds
the key and fails if it does not, which tells the caller the key exists. The
policy failed the same way in both cases. It is unreachable while the tenant
written is the one `withTenant` set, which every repository method guarantees.

A view defined with `SELECT *` fixes its column list when it is created. A
migration that adds a column to a spatial table has to recreate its view, or
the column is invisible to the service.
