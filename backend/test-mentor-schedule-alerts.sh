#!/usr/bin/env bash
# ./test-mentor-schedule-alerts.sh — mentors told of their own schedule, against a stand-in LMS on made-up mentors:
# throwaway mongod, nothing reading a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27100}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4149}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mentor-schedule-e2e.XXXXXX")"
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_mentor_schedule_e2e" E2E_FAKE_LMS_PORT="$LMS_PORT" \
  LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="mentor-schedule-e2e-secret" LMS_REMOTE_ORG_ID="e2e-org" \
  VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY="" SMTP_HOST="" SMTP_USER="" SMTP_PASS=""
cd "$HERE"
bun --no-env-file src/scripts/mentor-schedule-alerts-e2e.ts
