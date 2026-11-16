# shellcheck shell=bash
# Sourced by the scripts beside it. The install directory holds compose.yml and .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="$(sed -n 's/^name: //p' compose.yml)"

# Reads one key without sourcing .env, so its values are never executed.
env_value() {
  local value
  value="$(sed -n "s/^$1=//p" .env | tail -n 1)"
  printf '%s' "${value:-${2:-}}"
}

compose() {
  docker compose -f compose.yml --env-file .env "$@"
}

container_of() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

# Routing containers carry a label of their own: under the compose project label,
# compose would call them orphans and offer to remove them.
OSRM_LABEL="geo.osrm-of=$PROJECT"
OSRM_VERSION_LABEL=geo.osrm-version

osrm_containers() {
  docker ps "$@" --filter "label=$OSRM_LABEL"
}

# The build .osrm-version records, leaving out a new one still being checked.
recorded_osrm() {
  local version
  version="$(cat .osrm-version 2> /dev/null || true)"
  [ -z "$version" ] || osrm_containers "$@" --filter "label=$OSRM_VERSION_LABEL=$version"
}

# Asked from inside the container: from the host, a request arrives from the
# Docker gateway address, which ALLOWED_IPS does not list.
ready() {
  local api
  api="$(container_of api)"
  [ -n "$api" ] || return 1
  docker exec "$api" node -e "fetch('http://127.0.0.1:3000/health/ready').then((r) => r.json())
    .then((b) => process.exit(b.status === 'ok' ? 0 : 1), () => process.exit(1))"
}

# Held by deploy.sh while it replaces containers, so watch.sh skips that window.
take_lock() {
  exec 9> "$ROOT/.lock"
  flock "$@" 9
}

# Ping a healthchecks.io-style URL; a monitoring outage must not fail the job.
hc_ping() {
  local url="$1" suffix="${2:-}" body="${3:-}"
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$body" "$url$suffix" || true
}

log() {
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"
}
