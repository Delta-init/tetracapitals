#!/usr/bin/env bash
# ./test-set-meeting-mentor.sh — set-meeting-mentor.ts then backfill-meeting-mentor.ts, on made-up staff in a throwaway
# mongod; nothing reads a .env; HOME is the throwaway folder (the undo files). Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27099}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/set-meeting-mentor-e2e.XXXXXX")"
release() { local pids; pids="$(lsof -nP -t -iTCP:"$MONGO_PORT" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; }
cleanup() { local code=$?; release; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $MONGO_PORT busy" >&2; exit 1; }
mkdir -p "$WORK/db" "$WORK/home"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_set_meeting_mentor_e2e" HOME="$WORK/home" \
  JWT_SECRET="set-meeting-mentor-e2e-secret-0123456789" FINANCE_API_URL="" ROOT_ERP_API_URL="" LMS_API_URL="" SMTP_HOST=""
cd "$HERE"
bun --no-env-file src/scripts/set-meeting-mentor-e2e.ts
