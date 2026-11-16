#!/usr/bin/env bash
# Usage: update-datasets.sh [--accept-removed] [--accept-area-change]
# Builds the reference datasets from the extract update-osrm.sh last downloaded
# and publishes them only if the gate passes; otherwise the previous release
# keeps serving. The flags publish a release the gate held back for dropping
# codes, or for moving a district's area by more than 5%, once a person has read
# the report.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set -E

AIRPORTS_URL=https://davidmegginson.github.io/ourairports-data/airports.csv

accept=()
for arg in "$@"; do
  case "$arg" in
    --accept-removed | --accept-area-change) accept+=("$arg") ;;
    *)
      echo "usage: $(basename "$0") [--accept-removed] [--accept-area-change]" >&2
      exit 2
      ;;
  esac
done

exec 8> "$ROOT/.datasets.lock"
flock -n 8 || { log 'another dataset update is running'; exit 1; }

region_url="$(env_value OSRM_REGION_URL)"
memory="$(env_value DATASETS_MEMORY 4g)"
cpus="$(env_value DATASETS_CPUS 2)"
hc_url="$(env_value HC_DATASETS_URL)"
version="$(cat .deployed-version 2> /dev/null || true)"

pbf="$ROOT/data/osm/$(basename "$region_url")"
datasets_dir="$ROOT/data/datasets"
work="$ROOT/data/datasets-work"
name="geo-datasets"
failure=""
summary=""

fail() {
  failure="$*"
  log "$failure"
  exit 1
}

on_exit() {
  local status=$?
  docker rm -f "$name" > /dev/null 2>&1 || true
  rm -rf "$work"
  if [ "$status" -eq 0 ]; then
    hc_ping "$hc_url" "" "$summary"
  else
    hc_ping "$hc_url" /fail "${failure:-exited with $status}"
  fi
}
trap on_exit EXIT
trap 'failure="${failure:-line $LINENO: $BASH_COMMAND}"' ERR
trap 'fail "stopped by SIGTERM"' TERM
trap 'fail "interrupted"' INT

[ -n "$version" ] || fail 'no deployed version recorded; run deploy.sh first'
[ -n "$region_url" ] || fail 'OSRM_REGION_URL is unset: the datasets are built from the extract update-osrm.sh downloads'
[ -f "$pbf" ] || fail "$pbf is missing; update-osrm.sh downloads it"
[[ "$cpus" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail 'DATASETS_CPUS must be a number'
[[ "$memory" =~ ^[1-9][0-9]*[kmg]?$ ]] || fail "DATASETS_MEMORY takes Docker's form, such as 4g, not $memory"
[ -n "$(container_of db)" ] || fail 'db is not running'

hc_ping "$hc_url" /start

# Downloaded here: the pipeline container sits on the internal network, which has no route out.
rm -rf "$work"
mkdir -p "$work" "$datasets_dir"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 -m 300 -o "$work/airports.csv" "$AIRPORTS_URL" ||
  fail "download of $AIRPORTS_URL failed"
# The image runs as node (uid 1000), and api reads the result as the same user.
chown -R 1000:1000 "$work" "$datasets_dir"

image="ghcr.io/gokhanjs/postgis-geo-service:$version-tools"
docker pull -q "$image" > /dev/null || fail "pulling $image failed"

log "building reference datasets with $image from $(basename "$pbf")"
# A run killed outright skips its trap and would leave the name taken.
docker rm -f "$name" > /dev/null 2>&1 || true
set +e
# Passed by name, so the password stays out of the process list.
MIGRATION_DB_PASS="$(env_value MIGRATION_DB_PASS)" docker run --name "$name" \
  --memory "$memory" --memory-swap "$memory" --cpus "$cpus" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --network geo_internal \
  -e DB_HOST=db -e DB_PORT=5432 -e DB_NAME="$(env_value DB_NAME geo_service)" \
  -e MIGRATION_DB_USER="$(env_value MIGRATION_DB_USER postgres)" \
  -e MIGRATION_DB_PASS \
  -v "$pbf:/osm/$(basename "$pbf"):ro" -v "$datasets_dir:/datasets" -v "$work:/work" \
  "$image" node dist/scripts/datasets/update.js \
  --pbf "/osm/$(basename "$pbf")" --out /datasets --work /work \
  --source-url "$region_url" --airports-url "$AIRPORTS_URL" --airports-file /work/airports.csv \
  "${accept[@]}" > "$work/run.log" 2>&1
status=$?
set -e

cat "$work/run.log"
if [ "$status" -ne 0 ]; then
  [ "$(docker inspect -f '{{.State.OOMKilled}}' "$name" 2> /dev/null)" != true ] ||
    fail "the pipeline was killed at its $memory memory limit"
  # The gate's reasons when it blocked the release, otherwise the end of the error.
  reasons="$(grep '^gate: ' "$work/run.log" || tail -n 20 "$work/run.log")"
  fail "the pipeline exited with $status; the previous release keeps serving
$reasons"
fi
summary="$(tail -n 1 "$work/run.log")"
log "$summary"
