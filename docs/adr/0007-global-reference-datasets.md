# 7. Reference datasets are global files, not tenant tables

## Context

Clients need Turkey's provinces, districts and a set of reference points
(airports, ports, intercity bus stations) with codes they can store. Every
other table in the service belongs to a tenant and is reached through a tenant
view. This data belongs to no tenant: it is the same for everyone, changes
monthly at most, and is produced by a batch job rather than written by callers.

Clients also said how they will use it: they copy the boundaries into their own
store and look them up locally, and call this service live only for routing.

## Decision

The pipeline builds the data in a `reference` schema that only the migration
role can read, and publishes it as versioned GeoJSON packages on disk. The API
serves those files to any valid API key, read-only, through
`/api/v1/datasets/{name}/{version}/...`. It serves no query over the data.

## Reasoning

- **No tenant boundary to enforce.** Putting global rows behind tenant views
  would mean either a fake tenant or an exception to the rule that every
  repository method takes a tenant id. Files sit outside that model entirely,
  so the rule stays without exceptions.
- **The consumer wants a copy, not a query.** A versioned file with a sha256 in
  its manifest is exactly what a sync job needs: it can tell whether it already
  holds a version and verify what it downloaded. A query API would invite live
  lookups the clients said they do not want.
- **A bad build must not reach anyone.** Building in a staging schema and
  publishing by rename means a release is either complete and gated or absent.
  A table updated in place would expose a half-loaded state to readers.
- **Geometry and identity, not meaning** ([ADR 0001](0001-entity-as-the-domain-noun.md)).
  A package carries codes, names and shapes. What a district means to a
  caller, such as a service area, stays in the caller's system.

## Consequences

- There is no endpoint for "which district is this point in". A caller who wants
  that loads the package into its own database, or registers the districts it
  cares about as geofences.
- The service role has no grant on `reference`, so the API cannot read the
  staging tables even by mistake; the pipeline connects as the migration role.
- Disk holds the three newest versions. The API reads `index.json` and the
  manifest on every request; at this request rate that costs less than a cache
  invalidated by the publisher would.
- Packages carry OpenStreetMap data, so they are published under ODbL 1.0 with
  a NOTICE in each version, which the MIT licence of the code does not change.
