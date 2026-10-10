#!/usr/bin/env bash
# ./test-team-location.sh — Dubai / Bangalore teams: routing, inactivity and the Students filter
# (lib/location.ts), on made-up staff in a throwaway mongod; nothing reads a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27103}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/team-location-e2e.XXXXXX")"
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $MONGO_PORT busy" >&2; exit 1; }
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="team_location_e2e"
cd "$HERE"
HOME="$WORK" bun --no-env-file src/scripts/team-location-e2e.ts
