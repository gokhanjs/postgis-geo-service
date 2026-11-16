# Deploying

A single host running Docker, with a TLS-terminating reverse proxy in front.
Releases are images on GHCR, built for `linux/amd64` and `linux/arm64` when a
`v*` tag is pushed. The host pulls them; it never builds.

## Topology

```
client ─443─> reverse proxy ─> 127.0.0.1:API_PORT ─> api
                                                      │  geo_edge (bridge)
                                 geo_internal (internal: no route out)
                                 ├── api
                                 ├── db       (no published port)
                                 └── osrm-<build> (alias "osrm", run by bin/update-osrm.sh)
```

- Only `api` publishes a port, and only on loopback. Docker publishes ports
  through its own NAT rules, which a host firewall's INPUT chain never sees, so
  a port bound to `0.0.0.0` is open to the internet whatever the firewall says.
- `db` sits on `geo_internal` alone. It has no published port and no route out.
- `api` runs with a read-only root filesystem, no capabilities and
  `no-new-privileges`. Every service has a memory and CPU limit, because a host
  without swap answers memory pressure by killing processes.

## Files

| Path                                         | Purpose                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| `compose.yml`                                | `db`, the one-shot `migrate`, `api`                   |
| `.env.example`                               | Every variable; copy to `.env`                        |
| `bin/deploy.sh`                              | Starts a version, returns to the previous one on fail |
| `bin/watch.sh`                               | One health pass, reported to a ping URL               |
| `bin/backup.sh`                              | Nightly `pg_dump`, pruned after `BACKUP_KEEP_DAYS`    |
| `bin/admin-token.sh`                         | Issues the admin token, revoking the previous one     |
| `bin/update-osrm.sh`                         | Builds routing data and swaps it in without downtime  |
| `systemd/geo-{watch,backup}.{service,timer}` | Every minute, and nightly at 03:30                    |
| `systemd/geo-osrm-update.{service,timer}`    | Sundays at 03:00                                      |
| `nginx/geo-service.conf`                     | Reverse proxy with TLS and edge rate limiting         |

The scripts and units expect the install directory to be
`/opt/postgis-geo-service`. Running elsewhere means editing `ExecStart` in the
`.service` files.

## First install

As root, from a checkout of this directory:

```bash
mkdir -p /opt/postgis-geo-service
cp -R compose.yml bin systemd .env.example /opt/postgis-geo-service/
cd /opt/postgis-geo-service
cp .env.example .env && chmod 600 .env
```

Fill in `.env`. `DB_VERSION`, `DB_PASS` and `MIGRATION_DB_PASS` are required
and compose refuses to start without them; generate each password with
`openssl rand -hex 32`.
`DB_PASS` is read when the migration that creates the runtime role first runs,
so set it before the first deploy. Values are read literally: no quotes.

```bash
bin/deploy.sh 1.1.0
```

Then create the admin token, which the admin API needs to issue tenants and
their keys. Running it again revokes the previous token:

```bash
bin/admin-token.sh
```

Enable monitoring and backups:

```bash
cp systemd/geo-*.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now geo-watch.timer geo-backup.timer
```

Routing is optional; see [Routing](#routing) to turn it on.

Point the reverse proxy at `127.0.0.1:API_PORT` and set `TRUST_PROXY_HOPS=1`
only if it overwrites `X-Forwarded-For`; [`nginx/`](nginx/) shows how.

## Releasing

Tag `main` and push the tag:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The release workflow reruns CI, builds both images natively on each
architecture and publishes `ghcr.io/<owner>/postgis-geo-service:1.2.0` and
`ghcr.io/<owner>/postgis-geo-service-db:1.2.0`. On the host:

```bash
/opt/postgis-geo-service/bin/deploy.sh 1.2.0
```

`deploy.sh` takes a dump, starts the version, and keeps it only once
`/health/ready` answers `ok`. Otherwise it starts the previous version again and
exits non-zero; if that fails too, the service stays down and the next watch
pass reports it. `.deployed-version` and `.previous-version` record the state.

`deploy.sh` changes `api` and `migrate` only. The database image follows
`DB_VERSION` in `.env`, because an automatic rollback must never start an older
PostgreSQL or PostGIS on data a newer one has touched. Raise it only when
`docker/postgis/` changed, after a dump, and run `deploy.sh` with the current
version to apply it.

## Going back

```bash
/opt/postgis-geo-service/bin/deploy.sh --rollback
```

This swaps the service images only. A migration the newer version applied stays applied;
every migration has an `.undo` file, but when data depends on the new schema,
restore the dump taken just before the deploy instead.

## Routing

OSRM runs outside compose, one container per build, so a new build can start
beside the one serving. `bin/update-osrm.sh`:

1. downloads `OSRM_REGION_URL` into `data/osm/` and checks the `.md5` published
   beside it;
2. preprocesses it into `data/osrm/<build>/`, each step in a container with no
   network, capped at `OSRM_PREPARE_MEMORY`, logging its peak memory;
3. starts `osrm-<build>` on `geo_internal` without the `osrm` alias and asks it,
   from inside `api`, to route `OSRM_SMOKE_ROUTE`: the route must exist, fall
   within `OSRM_SMOKE_KM` and carry the new build's `data_version`;
4. only then moves the alias to it and stops the previous container. The API
   retries a dropped connection once, so requests in flight are still answered.

A failure before step 4 removes the new build and leaves the old one serving;
the script exits non-zero and posts the reason to `HC_OSRM_URL/fail`. The three
newest builds stay on disk, and the serving and previous ones always do.

The check runs from `api`, so deploy first. Then build, point the API at the
alias, and schedule the weekly refresh:

```bash
bin/update-osrm.sh
# set OSRM_URL=http://osrm:5000 in .env
bin/deploy.sh "$(cat .deployed-version)"
systemctl enable --now geo-osrm-update.timer
```

To serve the previous build again (run twice, it toggles back):

```bash
bin/update-osrm.sh --rollback
```

The defaults fit a 650 MB extract, measured on arm64: preprocessing took 8
minutes on 6 CPUs and peaked at 10.1 GiB, the build is 4 GB on disk, and the
server holds 2.7 GiB. Each cap is about 1.5 times its measurement
(`OSRM_PREPARE_MEMORY=16g`, `OSRM_MEMORY=5g`). During a swap two servers run,
and the host also needs room for the preprocessing peak, so budget about 22 GiB.
For another extract, run once with a generous cap, read the peak from the log
or the success ping, and set the caps from it.

## Monitoring

`watch.sh` skips its pass while a deploy holds the lock, then checks readiness, that `db` and `api` run and are healthy
(and the routing container, when `OSRM_URL` is set), restarts
since the previous pass, each container's memory against its limit (90%), disk
(85%) and the host's available memory (10%). The result goes to `HC_WATCH_URL`,
a [healthchecks.io](https://healthchecks.io)-style ping URL: success pings the
URL, failure posts the list of problems to `/fail`. Give the check a one-minute
period and a one-minute grace, and an outage reaches you within two minutes.

`backup.sh` pings `HC_BACKUP_URL` at `/start`, on success, and at `/fail`.
`update-osrm.sh` does the same with `HC_OSRM_URL`, reporting the build's
preprocessing time and peak memory on success; give that check a one-week period.

## Restoring

Prove a dump restores before you need it, into a throwaway database:

```bash
db=$(docker ps -q --filter label=com.docker.compose.project=postgis-geo-service-prod \
  --filter label=com.docker.compose.service=db)
docker exec "$db" createdb -U postgres restore_check
docker exec -i "$db" pg_restore -U postgres -d restore_check --no-owner < backups/<file>.dump
docker exec "$db" psql -U postgres -d restore_check -c 'SELECT count(*) FROM entity_locations'
docker exec "$db" dropdb -U postgres restore_check
```

To restore for real, stop `api`, restore over `geo_service` with
`pg_restore --clean --if-exists`, and start it again with `deploy.sh`. A dump
holds no roles: on a new host, deploy first so the migrations create the
runtime role, then restore.
