# 2. Tenant isolation lives in the database

## Context

The service is multi-tenant over shared tables. The original implementation
scoped every query with `WHERE tenant_id = $1` in application code.

That held until it did not. One upsert used a client-supplied identifier as a
global primary key and omitted the tenant from its conflict target, so the
second tenant to create a zone silently took over the first tenant's row,
`tenant_id` included. It was not an attack; it triggered on the second customer.

## Decision

PostgreSQL row-level security on both spatial tables, keyed on a
transaction-local `app.tenant_id`. The service connects as a restricted role.

## Reasoning

Application-level scoping is a convention, and conventions last exactly as long
as everyone remembers them. The defect above was not carelessness; the same
author scoped the delete correctly on the line below. A guarantee that depends
on remembering is not a guarantee.

With policies in place, a query that omits its tenant predicate returns nothing
instead of another tenant's rows. The failure mode moves from silent leakage to
visible emptiness, which is the direction a security control should fail.

Two details are load-bearing:

- A **superuser bypasses every policy**. Migrations run as the owner because
  they create extensions, roles and policies; the service runs as a role that
  owns nothing. Running the API as `postgres` would disable this entire record.
- The setting is **transaction-local**. A pooled connection outlives the request
  that used it, so a session-level `SET` would hand one tenant's identity to
  whichever request reused the connection next.

## Consequences

Every tenant-scoped read now costs four sequential round trips instead of one
(`BEGIN`, `set_config`, the query, `COMMIT`) against a pool of ten connections.
That is a real reduction in concurrency headroom, accepted deliberately: the
alternative is a correctness property that erodes.

Deployment gains a requirement: the runtime role must not be a superuser.
`SECURITY.md` states it, and an integration test asserts the policies are
enabled and enforced.
