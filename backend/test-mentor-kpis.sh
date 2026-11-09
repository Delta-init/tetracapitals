#!/usr/bin/env bash
# ./test-mentor-kpis.sh — My KPIs (2026-11-09): who may see whose mentor KPIs, and what is asked of Root — against a
# stand-in Root on made-up people: throwaway mongod, nothing reading a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27141}"; ROOT_PORT="${E2E_FAKE_ROOT_PORT:-4197}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mentor-kpis-e2e.XXXXXX")"
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$ROOT_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_mentor_kpis_e2e" E2E_FAKE_ROOT_PORT="$ROOT_PORT" \
  ROOT_ERP_API_URL="http://127.0.0.1:$ROOT_PORT" ROOT_ERP_SECRET="mentor-kpis-e2e-shared-secret-0123456789" \
  LMS_API_URL="" LMS_SERVICE_SECRET="" VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY="" SMTP_HOST="" SMTP_USER="" SMTP_PASS=""
cd "$HERE"
bun --no-env-file src/scripts/mentor-kpis-e2e.ts
