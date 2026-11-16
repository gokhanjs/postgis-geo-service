---
name: osrm-setup
description: Prepare an OSRM routing backend for this service - choosing a region extract, processing it, and wiring it up. Use when routing endpoints answer 503, when changing map region, or when refreshing map data.
---

# Preparing OSRM

Routing is optional here: without `OSRM_URL` the `/routing` endpoints answer
503 and everything else is unaffected. This skill covers turning it on.

## Decide first

**Which region.** Extracts come from [Geofabrik](https://download.geofabrik.de/).
Size drives everything downstream:

| Extract         | Download   | RAM to process | Time      |
| --------------- | ---------- | -------------- | --------- |
| Monaco          | ~600 KB    | negligible     | seconds   |
| A small country | 200-600 MB | 4-8 GB         | 10-30 min |
| A large country | 1-4 GB     | 16-32 GB       | hours     |

Processing is memory-bound and will be killed by the OOM reaper rather than
fail cleanly. If unsure, start with Monaco to prove the wiring, then swap.

**Which algorithm.** MLD (`osrm-partition` + `osrm-customize`) is the default
here: slower to query than CH but far faster to re-customize, which matters
when traffic or map data updates. CH (`osrm-contract`) suits a map that never
changes. The two are not interchangeable at serve time: `osrm-routed` must be
started with `--algorithm` matching how the data was prepared.

## Local development

The compose stack already does this behind a profile:

```bash
docker compose --profile routing up -d
```

Change the region by setting `OSRM_REGION_NAME` and `OSRM_REGION_URL` in
`.env`, then remove only the routing volume so preprocessing runs again. Never
`down -v`: that also deletes the database volume.

```bash
docker compose --profile routing down
docker volume rm postgis-geo-service_osrm-data
docker compose --profile routing up -d
```

Then set `API_OSRM_URL=http://osrm:5000` for the API container, or
`OSRM_URL=http://localhost:5000` for a service run on the host, and restart it.

## A deployed host

`deploy/bin/update-osrm.sh` builds each refresh beside the serving one and
swaps it in only after a known route checks out; `deploy/README.md` (Routing)
covers the variables, the first run, the weekly timer and `--rollback`.

## Verifying

`GET /health/ready` reports `osrm: ok`, `unreachable`, or `disabled`. Then
confirm the data covers the area you care about, which the health check cannot:

```bash
curl 'http://localhost:5000/route/v1/driving/<lng1>,<lat1>;<lng2>,<lat2>?overview=false'
```

Coordinates outside the extract return `NoRoute`, and the service reports the
distance as `null` rather than failing.

## Failure modes

- **`NoRoute` for coordinates you expect to work.** The extract does not cover
  them. Check the region bounds before suspecting the service.
- **Preprocessing killed with no error.** Out of memory. Use a smaller extract
  or raise the Docker memory limit (`OSRM_PREPARE_MEMORY` on a deployed host,
  where the script reports the kill and the peak it reached).
- **`osrm-routed` exits immediately.** The `--algorithm` flag disagrees with how
  the data was prepared.
- **Health says `unreachable` while the container is running.** Preprocessing
  produced no `.osrm` files; check the init container's logs rather than the
  serving one's.
