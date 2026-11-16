#!/usr/bin/env bash
# Writes a custom-format dump to backups/ and prunes old ones. Run nightly by geo-backup.timer.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

hc_url="$(env_value HC_BACKUP_URL)"
keep_days="$(env_value BACKUP_KEEP_DAYS 7)"
db_name="$(env_value DB_NAME geo_service)"
db_owner="$(env_value MIGRATION_DB_USER postgres)"

hc_ping "$hc_url" /start

fail() {
  log "$1"
  hc_ping "$hc_url" /fail "$1"
  exit 1
}

[[ "$keep_days" =~ ^[1-9][0-9]*$ ]] || fail "backup: BACKUP_KEEP_DAYS must be a whole number of days, got '$keep_days'"

db="$(container_of db)"
[ -n "$db" ] || fail 'backup: database container is not running'

mkdir -p backups
chmod 700 backups
file="backups/$db_name-$(date -u +%Y%m%dT%H%M%SZ).dump"

if ! docker exec "$db" pg_dump -U "$db_owner" -d "$db_name" -Fc > "$file.partial"; then
  rm -f "$file.partial"
  fail 'backup: pg_dump failed'
fi
mv "$file.partial" "$file"

find backups -name '*.dump' -mtime +"$((keep_days - 1))" -delete
find backups -name '*.partial' -mmin +60 -delete

log "backup: wrote $file ($(du -h "$file" | cut -f1))"
hc_ping "$hc_url" '' "$file"
