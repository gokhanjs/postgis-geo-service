# Security Policy

## Reporting a vulnerability

Report privately through this repository's GitHub security advisory form
(Security tab, "Report a vulnerability") rather than opening an issue. Expect an acknowledgement within a few days.

## What this service guarantees

- **Tenant isolation** of the two spatial tables is enforced by PostgreSQL,
  not by application predicates. The service connects as a role that owns nothing and
  can reach the tables only through views filtered on the request's tenant, so
  a query missing a tenant predicate returns nothing rather than another
  tenant's rows. The views are not security barriers, so an error raised by a
  query's own predicate could quote another tenant's value; repository SQL
  applies nothing that can raise to these columns. Row-level security policies
  on the tables cover any role later granted them directly.
- **Credentials are stored as digests.** API keys cannot be recovered from a
  database dump. Listing shows only a prefix.
- **The service cannot mint credentials.** Its database role may only read
  keys; they are issued and revoked from the command line as the owner
  ([ADR 0008](docs/adr/0008-credentials-issued-out-of-band.md)).
- **Errors do not describe the schema.** Unrecognised failures are logged in
  full server-side and answered with a generic problem document.

## What it assumes of the deployment

- The service is not exposed directly. `TRUST_PROXY_HOPS` is only safe if the
  proxy **overwrites** `X-Forwarded-For`; see `deploy/nginx/`.
- The runtime database role is not a superuser. A superuser can read the
  tables directly, past both the tenant views and the policies behind them.
- TLS terminates at the proxy. The service speaks plain HTTP.
