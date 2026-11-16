#!/usr/bin/env bash
# One health pass, reported to HC_WATCH_URL. Run every minute by geo-watch.timer.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

take_lock -n || exit 0

DISK_MAX_PERCENT=85
HOST_MEM_MIN_PERCENT=10
CONTAINER_MEM_MAX_PERCENT=90

problems=()
state_file=.watch-restarts
touch "$state_file"
rm -f "$state_file.next"

ready || problems+=('api: /health/ready is not ok')

for service in db api; do
  [ -n "$(container_of "$service")" ] || problems+=("$service: not running")
done
if [ -n "$(env_value OSRM_URL)" ] && [ -z "$(recorded_osrm -q)" ]; then
  problems+=('osrm: not running')
fi

ids="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" && recorded_osrm -q)" ||
  problems+=('docker: cannot list containers')
stats=""
# shellcheck disable=SC2086
if [ -n "$ids" ] && ! stats="$(docker stats --no-stream --format '{{.ID}} {{.MemPerc}}' $ids)"; then
  problems+=('docker: cannot read container memory')
fi

for id in $ids; do
  read -r name health restarts mem_limit < <(docker inspect -f \
    '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}} {{.HostConfig.Memory}}' \
    "$id" 2>/dev/null) || continue
  name="${name#/}"

  case "$health" in
    healthy | none) ;;
    *) problems+=("$name: health $health") ;;
  esac

  seen="$(sed -n "s/^$name //p" "$state_file")"
  if [ -n "$seen" ] && [ "$restarts" -gt "$seen" ]; then
    problems+=("$name: restarted $((restarts - seen)) time(s) since the last check")
  fi
  printf '%s %s\n' "$name" "$restarts" >> "$state_file.next"

  used="$(awk -v id="$id" '$1 == id { sub("%", "", $2); print $2 }' <<< "$stats")"
  if [ "$mem_limit" -gt 0 ] && [ -n "$used" ] &&
    awk -v u="$used" -v m="$CONTAINER_MEM_MAX_PERCENT" 'BEGIN { exit !(u >= m) }'; then
    problems+=("$name: memory at ${used}% of its limit")
  fi
done
if [ -f "$state_file.next" ]; then mv -f "$state_file.next" "$state_file"; else : > "$state_file"; fi

for mount in / "$(docker info -f '{{.DockerRootDir}}')"; do
  [ -d "$mount" ] || continue
  used="$(df -P "$mount" | awk 'NR == 2 { sub("%", "", $5); print $5 }')"
  [ "$used" -lt "$DISK_MAX_PERCENT" ] || problems+=("disk: $mount at ${used}%")
done

available="$(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { printf "%d", a * 100 / t }' /proc/meminfo)"
[ "$available" -ge "$HOST_MEM_MIN_PERCENT" ] || problems+=("host: ${available}% of memory available")

hc_url="$(env_value HC_WATCH_URL)"
if [ ${#problems[@]} -eq 0 ]; then
  hc_ping "$hc_url"
  exit 0
fi

report="$(printf '%s\n' "${problems[@]}")"
log "watch: $report"
hc_ping "$hc_url" /fail "$report"
exit 1
