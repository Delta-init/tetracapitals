#!/usr/bin/env bash
# ./test-programs.sh — Programs in the portal (functions/programs.ts), against a stand-in LMS on made-up people:
# throwaway mongod, nothing reading a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27101}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4150}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/programs-e2e.XXXXXX")"
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_programs_e2e" E2E_FAKE_LMS_PORT="$LMS_PORT" \
  LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="programs-e2e-secret" LMS_REMOTE_ORG_ID="e2e-org" \
  VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY="" SMTP_HOST="" SMTP_USER="" SMTP_PASS=""
cd "$HERE"
bun --no-env-file src/scripts/programs-e2e.ts
