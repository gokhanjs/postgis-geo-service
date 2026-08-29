---
description: Check whether a query actually uses its index, on realistic data
argument-hint: [the query, or the repository method name]
---

Determine whether $ARGUMENTS uses its index, and say so with evidence.

An index appearing in `\d` proves nothing. This project has already shipped an
index that existed, looked right, and contributed nothing to the query it was
built for.

1. Take the SQL from `src/repositories/`, not a paraphrase of it.

2. Build a scratch database from the current migrations and load enough rows
   that the planner has a real choice, at least 100k spread across several
   tenants and types. A few rows will produce a sequential scan regardless and
   tell you nothing.

3. Run it as `geo_app` with `app.tenant_id` set, so row-level security is
   active exactly as in production:

   ```sql
   EXPLAIN (ANALYZE, BUFFERS) <query>;
   ```

4. Read the plan for the specific failure this project has hit: the spatial
   predicate appearing under `Filter` rather than inside `Index Cond` means the
   index narrowed on the scalar columns only and every remaining row was
   fetched and tested. `Rows Removed by Filter` shows the cost.

5. If it is not being used, test the fix rather than guessing: reorder the
   index columns, remove a cast, and re-run on the same data.

6. Drop the scratch database and report the plan, the row counts, and the
   conclusion.
