#!/usr/bin/env bash
#
# LMS support tickets and class assignments, told to the student's CS — end to
# end (src/scripts/lms-activity-e2e.ts): a throwaway mongod, the API (for the
# student page), and a stand-in LMS the test serves itself. No .env is read,
# no mail is sent (the test catches it), and the API's own 2-minute run is
# switched off so the test drives every run.
#
#   ./test-lms-activity.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27097}"; API_PORT="${E2E_API_PORT:-4147}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4148}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lms-activity-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
# mongod --shutdown does not exist on macOS: the mongod is stopped by its port, like the API.
cleanup() { local code=$?; release "$API_PORT" "$LMS_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_lms_activity_e2e" JWT_SECRET="lms-activity-e2e-secret-0123456789abcdef" \
  PORT="$API_PORT" E2E_API_PORT="$API_PORT" E2E_FAKE_LMS_PORT="$LMS_PORT" UPLOAD_DIR="$WORK/uploads" \
  LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="lms-activity-e2e-service-secret-0123456789" \
  LMS_ACTIVITY=off LMS_ENROLMENT_SYNC=off FOLLOWUP_REMINDERS=off WHATSAPP=off APP_BASE_URL="https://portal.e2e.test" \
  ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
if ! bun --no-env-file src/scripts/lms-activity-e2e.ts; then echo "--- api log"; tail -30 "$WORK/api.log"; exit 1; fi
