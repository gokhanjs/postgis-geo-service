# PostGIS Geo Service

[![CI](https://github.com/gokhanjs/postgis-geo-service/actions/workflows/ci.yml/badge.svg)](https://github.com/gokhanjs/postgis-geo-service/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)

A multi-tenant geospatial service: proximity search, geofencing, and road
distance. It answers three questions for any number of independent client
systems, over one deployment.

| Question                              | Endpoint                           |
| ------------------------------------- | ---------------------------------- |
| What is near this point?              | `GET /api/v1/entities/nearby`      |
| Whose service area covers this point? | `GET /api/v1/geofences/containing` |
| How far by road, and how long?        | `POST /api/v1/routing/distances`   |

The service stores **geometry, not domain objects**. It never learns what a
restaurant is; it stores that some entity of some type, belonging to some
tenant, sits at a coordinate or serves a polygon. Everything else stays in the
system that owns it. That is what makes one deployment serve unrelated
products.

---

## Contents

- [Why this exists](#why-this-exists)
- [Worked example: food delivery](#worked-example-food-delivery)
- [Quick start](#quick-start)
- [API](#api)
- [Architecture](#architecture)
- [Tenant isolation](#tenant-isolation)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [Design decisions](#design-decisions)
- [Working with AI tools](#working-with-ai-tools)
- [License](#license)

---

## Why this exists

Spatial queries are the kind of thing every product reimplements badly. The
bounding-box approximation that is off by a few percent, the `ST_Contains` that
drops addresses on a shared street, the index that quietly stops being used
after a schema change. Doing it once, correctly, behind an HTTP boundary means
the application team asks a question instead of writing PostGIS.

Multi-tenancy is the other half. Isolation here is a **database guarantee**,
not a convention: PostgreSQL row-level security decides what a request can see,
so a query that forgets its tenant predicate returns nothing rather than
someone else's rows. See [Tenant isolation](#tenant-isolation).

---

## Worked example: food delivery

A delivery product asks three questions, and this service answers all of them.

**1. Register a restaurant and the area it delivers to.**

```bash
curl -X PUT http://localhost:3000/api/v1/entities/restaurant/rest-42 \
  -H 'x-api-key: gsk_...' -H 'content-type: application/json' \
  -d '{"lat": 41.0082, "lng": 28.9784, "is_active": true}'

curl -X PUT http://localhost:3000/api/v1/geofences/42 \
  -H 'x-api-key: gsk_...' -H 'content-type: application/json' \
  -d '{
        "entity_id": "rest-42",
        "entity_type": "restaurant",
        "is_active": true,
        "area": {"type": "Polygon", "coordinates": [[[28.96,40.99],[28.99,40.99],[28.99,41.02],[28.96,41.02],[28.96,40.99]]]}
      }'
```

**2. A customer opens the app. Who delivers to their address?**

```bash
curl 'http://localhost:3000/api/v1/geofences/containing?lat=41.0082&lng=28.9784&entity_type=restaurant' \
  -H 'x-api-key: gsk_...'
```

```json
{ "results": [{ "entity_id": "rest-42" }] }
```

**3. Order the results by real driving time, not straight-line distance.**

```bash
curl -X POST http://localhost:3000/api/v1/routing/distances \
  -H 'x-api-key: gsk_...' -H 'content-type: application/json' \
  -d '{"origin": {"lat": 41.0189, "lng": 28.9647},
       "destinations": [{"entity_id": "rest-42", "entity_type": "restaurant"}]}'
```

```json
[
  {
    "entity_id": "rest-42",
    "entity_type": "restaurant",
    "road_distance_km": 2.4,
    "duration_min": 7.5
  }
]
```

Nothing above is delivery-specific. Replace `restaurant` with `warehouse`,
`courier`, `charging_station` or `service_technician` and the same three
questions still hold.

---

## Quick start

Requires Docker and Node.js 22+.

```bash
git clone https://github.com/gokhanjs/postgis-geo-service.git
cd postgis-geo-service
cp .env.example .env
pnpm install
docker compose up -d
```

That brings up PostGIS, applies the migrations, and starts the API on port 3000. Confirm it:

```bash
curl http://localhost:3000/health/ready
```

Then issue yourself credentials:

```bash
pnpm generate:token                       # prints an admin token, once
curl -X POST http://localhost:3000/api/v1/admin/keys \
  -H "x-admin-token: gat_..." -H 'content-type: application/json' \
  -d '{"tenant_id": 1, "project_name": "acme-delivery"}'
```

Browse the API at **http://localhost:3000/docs**.

### Road routing (optional)

Routing needs an OSRM instance with a processed map extract. It sits behind a
compose profile because preprocessing takes minutes and gigabytes, and every
other endpoint works without it:

```bash
docker compose --profile routing up -d
```

The default extract is Monaco, which processes in seconds. Point
`OSRM_REGION_URL` at any [Geofabrik](https://download.geofabrik.de/) extract
for a real region, and set `OSRM_URL=http://localhost:5000` in `.env`. Without
it, `/routing/*` answers `503` and nothing else changes.

---

## API

Full reference at `/docs`, generated from the same TypeBox schemas the service
validates against, so the request and response shapes it documents are the ones
it enforces.

| Method   | Path                           | Purpose                                        |
| -------- | ------------------------------ | ---------------------------------------------- |
| `PUT`    | `/api/v1/entities/{type}/{id}` | Create or replace an entity's location         |
| `GET`    | `/api/v1/entities/nearby`      | Entities within a radius, nearest first, paged |
| `PUT`    | `/api/v1/geofences/{id}`       | Create or replace a geofence                   |
| `DELETE` | `/api/v1/geofences/{id}`       | Delete a geofence                              |
| `GET`    | `/api/v1/geofences/containing` | Geofences covering a point                     |
| `POST`   | `/api/v1/routing/distances`    | Road distance and duration to many entities    |
| `POST`   | `/api/v1/admin/keys`           | Issue an API key                               |
| `GET`    | `/api/v1/admin/keys`           | List keys by prefix                            |
| `DELETE` | `/api/v1/admin/keys/{prefix}`  | Revoke a key                                   |
| `GET`    | `/health/live` `/health/ready` | Liveness and readiness                         |

Spatial routes authenticate with `x-api-key`, which also identifies the tenant.
Admin routes use `x-admin-token`.

### Errors

Every failure is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
details, served as `application/problem+json`:

```json
{
  "type": "urn:geo-service:problem:invalid-geometry",
  "title": "Invalid geometry",
  "status": 400,
  "detail": "Each polygon ring must be closed: the last position repeats the first",
  "instance": "/api/v1/geofences/42"
}
```

`type` is a stable identifier to branch on, deliberately a URN rather than a
URL: a link that has to stay alive is a worse contract than a name that cannot
rot. `title` and `detail` are for people.

### Coordinate order

Coordinates are always `[longitude, latitude]` in GeoJSON bodies, per
[RFC 7946](https://www.rfc-editor.org/rfc/rfc7946), and named `lat`/`lng`
explicitly in query parameters and JSON fields, where order carries no meaning.

---

## Architecture

```
Request
  │
  ├─ Fastify          proxy trust by hop count, request id, body limit
  ├─ onRequest        helmet → CORS → rate limit (per key) → IP allowlist
  ├─ schema           TypeBox → JSON Schema → ajv. Invalid requests stop here
  ├─ preHandler       API key resolves the tenant onto the request
  │
  ├─ route            HTTP mapped to a service call. No logic, no SQL
  ├─ service          business logic and caching. Knows neither HTTP nor SQL
  ├─ repository       all SQL, and nothing else. Sets the tenant on the session
  └─ PostgreSQL       row-level security enforces the tenant boundary
       ↑
       └─ the guarantee holds even if the query above forgets its predicate
```

Part of the layering is enforced rather than documented: ESLint rejects both a
`pg` import and an `app.pg` access from `src/routes` or `src/services`, and CI
rejects a cast of an indexed geometry column or an `ST_Contains`. The rest of
`AGENTS.md` is convention that review has to catch.

```
src/
├─ config/         environment read and validated once, at startup
├─ plugins/        database, auth, security, error handling, OpenAPI
├─ routes/         request to service-call mapping
├─ services/       business logic
├─ repositories/   every SQL statement in the codebase
├─ schemas/        TypeBox definitions: validation and documentation both
└─ lib/            geometry validation, OSRM client, problem details, cache
```

---

## Tenant isolation

The service connects to PostgreSQL as a **restricted role**, not the owner.
Each request sets `app.tenant_id` transaction-locally, and row-level security
policies filter every read and write of the two spatial tables against it. The
credential tables sit outside those policies by necessity: resolving which
tenant is calling happens before there is a tenant to filter on.

This matters because the alternative is a convention. In a codebase where
isolation depends on every query carrying `WHERE tenant_id = $1`, isolation
lasts exactly until someone forgets. Here, forgetting yields an empty result,
not a leak.

Two details make it real rather than decorative:

- **A superuser bypasses every policy.** Migrations run as the owner because
  they create extensions, roles and policies; the service runs as `geo_app`,
  which owns nothing. Running the API as `postgres` would silently disable
  every policy in this section.
- **The setting is transaction-local.** A pooled connection outlives the
  request that used it, so a session-level `SET` would hand one tenant's
  identity to the next request that reused the connection.

Ten tests assert this: six against the policies directly, issuing queries with
no tenant predicate at all, and four driving the running service over HTTP as
one tenant to confirm another tenant's data is unreachable.

---

## Configuration

`.env.example` documents every variable. The ones that matter:

| Variable                                  | Default    | Notes                                                   |
| ----------------------------------------- | ---------- | ------------------------------------------------------- |
| `DB_USER` / `DB_PASS`                     | `geo_app`  | The restricted runtime role                             |
| `MIGRATION_DB_USER` / `MIGRATION_DB_PASS` | `postgres` | Owner, for DDL only                                     |
| `OSRM_URL`                                | unset      | Unset disables routing; every other route is unaffected |
| `ALLOWED_IPS`                             | unset      | Unset accepts any address                               |
| `TRUST_PROXY_HOPS`                        | unset      | Set **only** if the proxy overwrites `X-Forwarded-For`  |
| `CORS_ORIGINS`                            | unset      | Unset refuses cross-origin requests                     |
| `RATE_LIMIT_MAX`                          | `100`      | Per API key per window, not per address                 |
| `BODY_LIMIT_BYTES`                        | `262144`   | Largest accepted request body                           |

> `TRUST_PROXY_HOPS` is a hop count on purpose. Trusting the whole
> `X-Forwarded-For` chain, combined with nginx's usual
> `$proxy_add_x_forwarded_for` (which appends), lets a client put any address
> at the head of the list and walk past both the allowlist and the rate limit.
> See [`deploy/nginx/`](deploy/nginx/).

---

## Development

```bash
pnpm install
pnpm db:up          # PostGIS only
pnpm migrate
pnpm dev            # Node runs the TypeScript directly, no build step
pnpm test           # integration tests against real PostGIS
pnpm typecheck && pnpm lint
```

There is no `ts-node` or `tsx`: Node 22 executes TypeScript natively, and
`tsc` emits `dist/` for production only.

The test suite runs against a real PostGIS instance rather than mocks. Spatial
behaviour is the thing under test, and a mock of `ST_Covers` would assert only
that the mock was written to agree with the test.

---

## Deployment

```bash
docker compose up -d --build
```

The image is multi-stage, runs as a non-root user under `dumb-init` so
shutdown receives `SIGTERM`, and reports health on `/health/live`. Migrations
run as a separate one-shot service that must succeed before the API starts,
because the API's own database role is created by a migration.

For a bare-metal deployment behind nginx, [`deploy/nginx/`](deploy/nginx/)
carries a configuration with TLS, edge rate limiting, and the
`X-Forwarded-For` handling the service's proxy trust depends on.

---

## Design decisions

Recorded in [`docs/adr/`](docs/adr/), including why the domain noun is
`entity`, why isolation is enforced in the database, why the migration runner
is hand-written rather than a library, and which technologies were deliberately
left out.

---

## Working with AI tools

[`AGENTS.md`](AGENTS.md) states the architectural invariants a coding agent
needs in order to be useful here: SQL belongs in `src/repositories`, geometry
columns are `geography` and must not be cast per query, `ST_Covers` rather than
`ST_Contains`, and so on. These are not style preferences; each one is a defect
this project has already had.

The same rules are enforced mechanically where possible, so the file is a
contract rather than a note. `.claude/` carries commands for scaffolding and a
reviewer agent that checks queries for the mistakes listed above.

---

## License

MIT. See [LICENSE](LICENSE).
