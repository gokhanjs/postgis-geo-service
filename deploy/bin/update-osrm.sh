#!/usr/bin/env bash
# Usage: update-osrm.sh [--rollback]
# Builds routing data from a fresh extract and starts it beside the serving
# version. The "osrm" alias moves to it only after a known route checks out, so
# a bad build leaves the old one serving. --rollback serves the previous build.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set -E

NETWORK=geo_internal
ALIAS=osrm
KEEP_VERSIONS=3

usage() {
  echo "usage: $(basename "$0") [--rollback]" >&2
  exit 2
}

[ $# -le 1 ] || usage
mode=update
if [ $# -eq 1 ]; then
  [ "$1" = --rollback ] || usage
  mode=rollback
fi

exec 8> "$ROOT/.osrm.lock"
flock -n 8 || { log 'another routing update is running'; exit 1; }

image="$(env_value OSRM_IMAGE ghcr.io/project-osrm/osrm-backend:v26.11.0-debian)"
region_url="$(env_value OSRM_REGION_URL)"
smoke_route="$(env_value OSRM_SMOKE_ROUTE)"
smoke_km="$(env_value OSRM_SMOKE_KM)"
prepare_memory="$(env_value OSRM_PREPARE_MEMORY 16g)"
prepare_cpus="$(env_value OSRM_PREPARE_CPUS 4)"
serve_memory="$(env_value OSRM_MEMORY 5g)"
serve_cpus="$(env_value OSRM_CPUS 2)"
hc_url="$(env_value HC_OSRM_URL)"

osm_dir="$ROOT/data/osm"
versions_dir="$ROOT/data/osrm"

failure=""
prepare=""
work=""
built=""
candidate=""
switched=false
summary=""

fail() {
  failure="$*"
  ! $switched || failure="$failure; the alias already serves the new build, and --rollback returns to the previous one"
  log "$failure"
  exit 1
}

on_exit() {
  local status=$?
  [ -z "$prepare" ] || docker rm -f "$prepare" > /dev/null 2>&1 || true
  [ -z "$work" ] || rm -rf "$work"
  if [ "$status" -ne 0 ] && ! $switched; then
    [ -z "$candidate" ] || docker rm -f "osrm-$candidate" > /dev/null 2>&1 || true
    [ -z "$built" ] || rm -rf "${versions_dir:?}/$built"
  fi
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

[[ "$smoke_route" =~ ^-?[0-9.]+,-?[0-9.]+\;-?[0-9.]+,-?[0-9.]+$ ]] ||
  fail 'OSRM_SMOKE_ROUTE must be "lng,lat;lng,lat", a pair the extract covers'
[[ "$smoke_km" =~ ^[0-9.]+-[0-9.]+$ ]] ||
  fail 'OSRM_SMOKE_KM must be "min-max", the road distance expected for OSRM_SMOKE_ROUTE'
[[ "$prepare_cpus" =~ ^[1-9][0-9]*$ ]] || fail 'OSRM_PREPARE_CPUS must be a whole number'
[[ "$serve_cpus" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail 'OSRM_CPUS must be a number'
for memory in "$prepare_memory" "$serve_memory"; do
  [[ "$memory" =~ ^[1-9][0-9]*[kmg]?$ ]] || fail "memory limits take Docker's form, such as 16g, not $memory"
done
[ "$mode" = rollback ] || [[ "$region_url" =~ ^https?://[^[:space:]]+\.osm\.pbf$ ]] ||
  fail 'OSRM_REGION_URL must be the http(s) URL of an .osm.pbf extract'
docker network inspect "$NETWORK" > /dev/null 2>&1 || fail "network $NETWORK is missing; run deploy.sh first"
# Checked now, not after hours of preprocessing: the route check runs from api.
[ -n "$(container_of api)" ] || fail 'api is not running, so there is no client to check routing from'

serving() {
  osrm_containers --format "{{.Label \"$OSRM_VERSION_LABEL\"}}"
}

# The record, not the running container: a crashed build is still the current one.
current="$(cat .osrm-version 2> /dev/null || true)"

hc_ping "$hc_url" /start

# A run killed outright skips its traps; clear what it left before starting.
docker ps -aq --filter name=^osrm-prepare- | xargs -r docker rm -f > /dev/null
rm -rf "$versions_dir"/.building-*
for stale in $(osrm_containers -a --format "{{.Label \"$OSRM_VERSION_LABEL\"}}"); do
  [ "$stale" != "$current" ] || continue
  # A promoted build gets a restart policy; an unchecked candidate or a stopped one is debris.
  if [ "$(docker inspect -f '{{.State.Running}} {{.HostConfig.RestartPolicy.Name}}' "osrm-$stale")" != 'true unless-stopped' ]; then
    docker rm -f "osrm-$stale" > /dev/null
  fi
done

# docker stats prints binary units, e.g. "10.17GiB / 16GiB".
to_mib() {
  awk '{
    v = $1; u = $1
    sub(/[A-Za-z]+$/, "", v); sub(/^[0-9.]+/, "", u)
    f = u == "GiB" ? 1024 : u == "MiB" ? 1 : u == "KiB" ? 1 / 1024 : u == "TiB" ? 1048576 : 0
    printf "%d", v * f
  }'
}

download() {
  local tmp status expected actual
  pbf="$osm_dir/$(basename "$region_url")"
  tmp="$pbf.part"
  mkdir -p "$osm_dir"
  log "downloading $region_url"
  # A stalled transfer is abandoned and retried rather than left to the unit's timeout.
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 --speed-limit 10240 --speed-time 120 \
    -o "$tmp" "$region_url" || fail "download of $region_url failed"
  status="$(curl -sSL --retry 3 --retry-delay 10 -o "$tmp.md5" -w '%{http_code}' "$region_url.md5")" || status=none
  case "$status" in
    200)
      expected="$(cat "$tmp.md5")"
      actual="$(md5sum "$tmp")"
      rm -f "$tmp.md5"
      [ "${expected%% *}" = "${actual%% *}" ] || { rm -f "$tmp"; fail 'the extract does not match its published md5'; }
      ;;
    404)
      rm -f "$tmp.md5"
      log 'no .md5 published beside the extract, so its integrity is not checked'
      ;;
    *)
      rm -f "$tmp.md5"
      fail "fetching $region_url.md5 failed ($status)"
      ;;
  esac
  mv -f "$tmp" "$pbf"
}

# Runs one preprocessing step in a memory-capped container, sampling its peak
# usage, because an extract that outgrows the cap is killed rather than failing.
prepare_step() {
  local step="$1" started=$SECONDS peak=0 used state
  shift
  prepare="osrm-prepare-$version"
  docker run -d --name "$prepare" \
    --memory "$prepare_memory" --memory-swap "$prepare_memory" --cpus "$prepare_cpus" \
    --network none --cap-drop ALL --security-opt no-new-privileges:true \
    -v "$work:/data" "$image" nice -n 10 "$@" -t "$prepare_cpus" > /dev/null
  while [ "$(docker inspect -f '{{.State.Running}}' "$prepare")" = true ]; do
    used="$(docker stats --no-stream --format '{{.MemUsage}}' "$prepare" 2> /dev/null | to_mib)" || true
    [ "${used:-0}" -le "$peak" ] || peak="$used"
    sleep 1
  done
  state="$(docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' "$prepare")"
  if [ "$state" != '0 false' ]; then
    docker logs --tail 30 "$prepare" >&2 || true
    case "$state" in
      *true | '137 '*) fail "$step was killed at its $prepare_memory memory limit (peak ${peak} MiB)" ;;
      *) fail "$step exited with ${state% *}" ;;
    esac
  fi
  docker rm "$prepare" > /dev/null
  prepare=""
  log "$step: $((SECONDS - started)) s, peak ${peak} MiB"
  [ "$peak" -le "$peak_mib" ] || peak_mib="$peak"
}

# Builds under a dot name, renamed only when complete, so a half-built directory
# never counts as a build.
build() {
  local started=$SECONDS version
  peak_mib=0
  version="osm-$(date -u +%Y%m%dT%H%M%SZ)"
  [ ! -e "$versions_dir/$version" ] || fail "$versions_dir/$version already exists"
  work="$versions_dir/.building-$version"
  mkdir -p "$work"
  ln "$pbf" "$work/map.osm.pbf" 2> /dev/null || cp "$pbf" "$work/map.osm.pbf"

  prepare_step extract osrm-extract -p /opt/car.lua --data_version "$version" /data/map.osm.pbf
  rm -f "$work/map.osm.pbf"
  prepare_step partition osrm-partition /data/map.osrm
  prepare_step customize osrm-customize /data/map.osrm
  mv "$work" "$versions_dir/$version"
  work=""
  built="$version"
  summary="$built prepared in $((SECONDS - started)) s, peak ${peak_mib} MiB of $prepare_memory"
}

start_candidate() {
  local version="$1" name="osrm-$1" deadline=$((SECONDS + 600))
  candidate="$version"
  docker rm -f "$name" > /dev/null 2>&1 || true
  # Joins without the alias, so nothing routes to it before the check below, and
  # without a restart policy until then, so a build that crashes stays down.
  docker run -d --name "$name" --label "$OSRM_LABEL" --label "$OSRM_VERSION_LABEL=$version" \
    --memory "$serve_memory" --memory-swap "$serve_memory" --cpus "$serve_cpus" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    --network "$NETWORK" \
    --health-cmd 'bash -c "exec 3<>/dev/tcp/127.0.0.1/5000"' \
    --health-interval 30s --health-timeout 5s --health-retries 3 \
    --health-start-period 10m --health-start-interval 2s \
    -v "$versions_dir/$version:/data:ro" "$image" \
    osrm-routed --algorithm mld /data/map.osrm > /dev/null

  log "waiting for $name"
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ]; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ] || [ $SECONDS -ge $deadline ]; then
      docker logs --tail 30 "$name" >&2 || true
      fail "$name did not become healthy"
    fi
    sleep 2
  done
}

# Asks from inside the api container, the consumer, over the network it uses.
check_route() {
  local host="$1" expected="$2" api answer code meters data_version
  api="$(container_of api)"
  [ -n "$api" ] || fail 'api stopped, so there is no client to check routing from'
  answer="$(docker exec "$api" node -e '
    const [host, route] = process.argv.slice(1);
    fetch(`http://${host}:5000/route/v1/driving/${route}?overview=false`, { signal: AbortSignal.timeout(10000) })
      .then((r) => r.json())
      .then((b) => console.log(b.code ?? "-", b.routes?.[0]?.distance ?? "-", b.data_version ?? "-"),
        (e) => console.log("unreachable", "-", "-"))' "$host" "$smoke_route")"
  read -r code meters data_version <<< "$answer"
  [ "$code" = Ok ] || fail "routing check against $host answered $code"
  [ "$data_version" = "$expected" ] || fail "$host serves $data_version, expected $expected"
  awk -v m="$meters" -v r="$smoke_km" 'BEGIN { split(r, b, "-"); k = m / 1000; exit !(k >= b[1] && k <= b[2]) }' ||
    fail "routing check against $host measured $meters m, outside $smoke_km km"
  log "$host routes the check pair at $meters m"
}

switch_to() {
  local version="$1" old
  # Held while the alias moves, so watch.sh does not report the overlap.
  take_lock
  docker network disconnect "$NETWORK" "osrm-$version"
  docker network connect --alias "$ALIAS" "$NETWORK" "osrm-$version"
  docker update --restart unless-stopped "osrm-$version" > /dev/null
  switched=true
  if [ "$current" != "$version" ]; then
    [ -z "$current" ] || printf '%s\n' "$current" > .osrm-previous-version
    printf '%s\n' "$version" > .osrm-version
  fi

  for old in $(serving); do
    [ "$old" = "$version" ] && continue
    log "stopping osrm-$old"
    docker stop -t 10 "osrm-$old" > /dev/null
  done
  check_route "$ALIAS" "$version"
  for old in $(osrm_containers -a --filter status=exited --format "{{.Label \"$OSRM_VERSION_LABEL\"}}"); do
    [ "$old" = "$version" ] || docker rm "osrm-$old" > /dev/null
  done
  exec 9>&-
}

# Keeps the newest builds, and always the serving and the previous one.
prune() {
  local serving_now previous name
  serving_now="$(cat .osrm-version)"
  previous="$(cat .osrm-previous-version 2> /dev/null || true)"
  for name in $(ls -1 "$versions_dir" | grep '^osm-' | sort -r | tail -n +$((KEEP_VERSIONS + 1))); do
    case "$name" in
      "$serving_now" | "$previous") continue ;;
    esac
    log "removing $name"
    rm -rf "${versions_dir:?}/$name"
  done
}

if [ "$mode" = rollback ]; then
  target="$(cat .osrm-previous-version 2> /dev/null || true)"
  [ -n "$target" ] || fail 'no previous routing version recorded'
  [ "$target" != "$current" ] || fail "$target is already serving"
  [ -d "$versions_dir/$target" ] || fail "$versions_dir/$target is gone"
  summary="rolled back to $target"
else
  download
  build
  target="$built"
fi

start_candidate "$target"
check_route "osrm-$target" "$target"
switch_to "$target"
prune
log "$target is serving${current:+, replacing $current}"
