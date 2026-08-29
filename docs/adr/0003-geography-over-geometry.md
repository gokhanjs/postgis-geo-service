# 3. Geography columns, not geometry with casts

## Context

The original schema stored `geometry(Point, 4326)` and cast to `geography` in
each query, to get spheroid-accurate distances:

```sql
ST_DWithin(location::geography, $1::geography, $2)
```

## Decision

Store `geography(Point, 4326)` and `geography(Polygon, 4326)` directly.

## Reasoning

The cast was the problem it appeared to solve. A GiST index on a geometry
column cannot serve a predicate over `location::geography`, because the
predicate's operand is an expression rather than the column. The index existed,
looked correct in `\d`, and contributed nothing; lookup cost grew linearly with
a tenant's row count.

Storing geography removes the cast, and the index applies.

The change forced two related corrections, which is why they are not separate
records:

- **`ST_Contains` has no geography form.** Its counterpart is `ST_Covers`,
  which is also the semantically correct choice: `ST_Contains` excludes the
  boundary, so an address on an edge shared by two adjacent service areas
  belonged to neither.
- **The filter and the reported distance used different earth models.**
  `ST_DWithin` on geography measures on the spheroid while `ST_DistanceSphere`
  reports on a sphere, so results near the radius disagreed with the filter
  that admitted them. Both now use `ST_Distance` on geography.

## Consequences

Geography arithmetic is more expensive per operation than geometry in a planar
projection. For a service whose radii are measured in kilometres and whose
correctness matters more than microseconds, that is the right trade.

Index column order turned out to matter more than expected: leading with the
scalar columns left the planner free to drop the spatial predicate from the
index condition on some data distributions. The geography column leads.
