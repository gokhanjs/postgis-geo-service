#!/usr/bin/env bash
# Issues, lists or revokes API keys: api-key.sh issue --tenant <id> --project <name> | list | revoke <prefix>
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="$(cat .deployed-version 2>/dev/null || true)"
[ -n "$version" ] || { log 'nothing deployed yet; run deploy.sh first'; exit 1; }

# The runtime role may only read keys. The migrate container carries the owner's
# credentials in its environment, so no password reaches a host command line.
GEO_VERSION="$version" compose run --rm --no-deps migrate node dist/scripts/keys.js "$@"
