# Security Policy

## Reporting a vulnerability

Report privately through GitHub's
[security advisory](https://github.com/gokhanjs/postgis-geo-service/security/advisories/new)
form rather than opening an issue. Expect an acknowledgement within a few days.

## What this service guarantees

- **Tenant isolation** is enforced by PostgreSQL row-level security, not by
  application predicates. The service connects as a role that owns nothing and
  has no `BYPASSRLS`, so a query missing a tenant predicate returns nothing
  rather than another tenant's rows.
- **Credentials are stored as digests.** API keys and admin tokens cannot be
  recovered from a database dump. Listing shows only a prefix.
- **Errors do not describe the schema.** Unrecognised failures are logged in
  full server-side and answered with a generic problem document.

## What it assumes of the deployment

- The service is not exposed directly. `TRUST_PROXY_HOPS` is only safe if the
  proxy **overwrites** `X-Forwarded-For`; see `deploy/nginx/`.
- The runtime database role is not a superuser. A superuser bypasses every
  row-level security policy, which would silently disable tenant isolation.
- TLS terminates at the proxy. The service speaks plain HTTP.
