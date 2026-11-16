#!/usr/bin/env bash
# Issues a new admin token and revokes the previous one. Prints the token once.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="$(cat .deployed-version 2>/dev/null || true)"
[ -n "$version" ] || { log 'nothing deployed yet; run deploy.sh first'; exit 1; }

# The runtime role may only read admin tokens, so this runs as the owner. The
# password is expanded inside the container, never on a host command line.
# shellcheck disable=SC2016
GEO_VERSION="$version" compose run --rm --no-deps migrate sh -c \
  'DB_USER="$MIGRATION_DB_USER" DB_PASS="$MIGRATION_DB_PASS" exec node dist/scripts/generate-token.js'
