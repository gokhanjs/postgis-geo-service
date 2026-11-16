---
description: Create a migration pair and verify it applies and rolls back
argument-hint: [what the migration does, e.g. "add opening hours to entities"]
---

Write a migration for: $ARGUMENTS

1. Find the highest number in `migrations/` and create both files:
   `NNN.do.<kebab-name>.sql` and `NNN.undo.<kebab-name>.sql`, zero-padded to
   three digits.

2. Apply the schema rules from AGENTS.md:
   - Spatial columns are `geography(...,4326)`, never `geometry`.
   - A composite GiST index leads with the geography column.
   - `NOT NULL` with a default unless absence is meaningful.
   - New tables that hold tenant data need a row-level security policy and a
     tenant view filtered on `current_tenant_id()` with
     `WITH CASCADED CHECK OPTION`, never `security_barrier`. `geo_app` is
     granted the view, not the table.
   - Adding a column to a table behind a tenant view means recreating the view:
     `SELECT *` fixed its column list when it was created.
   - `updated_at` is maintained by the `touch_updated_at` trigger, not by the
     write path.

3. Verify both directions against a clean database, and show the output:

   ```
   docker compose down -v && docker compose up -d db
   pnpm migrate && pnpm migrate:down && pnpm migrate
   ```

4. If the change affects a query path, run `/explain-plan` on it and confirm
   the index is used before declaring the migration done.
