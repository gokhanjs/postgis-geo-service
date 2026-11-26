# 8. API keys are issued out of band

## Context

Keys were issued, listed and revoked over HTTP, behind an admin token. That
put the power to mint credentials inside the process that faces the network:
the runtime role needed `INSERT` and `UPDATE` on `api_keys`, so any flaw that
let a request run arbitrary SQL as that role, or skip the admin check, could
create a working key or reactivate a revoked one. Once the service is reachable
from outside, that is the single most valuable thing an attacker could take.

Issuing keys is rare and always done by an operator who already has a shell on
the host. Nothing about it needs the network.

## Decision

- Keys are managed by `scripts/keys.ts` (`issue`, `list`, `revoke`), run as the
  database owner. On a server, `deploy/bin/api-key.sh` runs it in the one-shot
  migrate container, so the owner's password never reaches a host command line.
- The runtime role keeps only `SELECT` on `api_keys` (migration 009). The
  admin token, its table and its routes are gone.
- A key is printed once, when issued. Only its SHA-256 digest is stored, and
  `list` shows the 12-character prefix, never the key.

## Consequences

- A compromised service process can authenticate requests but cannot create,
  extend or revive a credential. A leaked database backup yields digests, which
  cannot be replayed.
- Revocation no longer evicts the service's key cache, which lives in another
  process. A revoked key keeps working for up to the cache's one-minute TTL.
  Accepted: the cache is what keeps key lookups off the database, and a minute
  is short against the time it takes to notice a leak.
- Removing the routes breaks any client that used them, hence a major version.
  Issuing a key now requires shell access to the host, which is the point.
