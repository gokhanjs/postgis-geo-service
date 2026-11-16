#!/usr/bin/env bash
# Usage: deploy.sh <version> | --rollback
# Starts <version> and keeps it only if it reports ready; otherwise the
# previously deployed version is started again and the script fails.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  echo "usage: $(basename "$0") <version> | --rollback" >&2
  exit 2
}

[ $# -eq 1 ] || usage
take_lock -n || { log 'another deploy is running'; exit 1; }

current="$(cat .deployed-version 2>/dev/null || true)"

if [ "$1" = --rollback ]; then
  target="$(cat .previous-version 2>/dev/null || true)"
  [ -n "$target" ] || { log 'no previous version recorded'; exit 1; }
else
  target="$1"
fi
[[ "$target" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || usage

start() {
  GEO_VERSION="$1" compose up -d --wait --wait-timeout 120 api && ready
}

log "pulling $target"
# Version tags are immutable, so an image already present is the right one.
GEO_VERSION="$target" compose pull --policy missing db migrate api

if [ -n "$current" ] && [ -n "$(container_of db)" ]; then
  log 'backing up before migrations run'
  "$ROOT/bin/backup.sh"
elif [ -n "$current" ]; then
  log 'database not running, so nothing has changed since the last nightly dump'
fi

log "starting $target"
if start "$target"; then
  if [ "$target" != "$current" ]; then
    [ -z "$current" ] || printf '%s\n' "$current" > .previous-version
    printf '%s\n' "$target" > .deployed-version
  fi
  log "$target is ready"
  exit 0
fi

log "$target did not become ready"
GEO_VERSION="$target" compose logs --tail 50 migrate api >&2 || true

if [ -z "$current" ] || [ "$current" = "$target" ]; then
  log 'no earlier version to return to'
  exit 1
fi

log "returning to $current"
if start "$current"; then
  log "$current is serving again. Any migration $target applied remains; the dump taken before it is in backups/."
else
  log "$current did not become ready either; the service is down"
fi
exit 1
