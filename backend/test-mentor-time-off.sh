#!/usr/bin/env bash
# ./test-mentor-time-off.sh — mentors' time off from the Mentor Calendar, end to end: a throwaway mongod, this API and
# the real LMS backend (beside this repository at ../../lms/backend, or LMS_BACKEND) — neither reading a .env. Tears
# everything down afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LMS_BACKEND="${LMS_BACKEND:-$HERE/../../lms/backend}"
[ -f "$LMS_BACKEND/src/index.ts" ] || { echo "No LMS backend at $LMS_BACKEND (set LMS_BACKEND)" >&2; exit 1; }
MONGO_PORT="${E2E_MONGO_PORT:-27093}"; API_PORT="${E2E_API_PORT:-4167}"; LMS_PORT="${E2E_LMS_PORT:-4168}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mentor-time-off-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT" "$LMS_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
MONGO="mongodb://127.0.0.1:$MONGO_PORT"
SECRET="mentor-time-off-e2e-lms-secret-0123456789"
ORG="6a0e2e000000000000000001"   # the academy this API asks the LMS about; the script makes it

# The LMS: scratch database, the secret this API calls it with, nothing from its .env.
( cd "$LMS_BACKEND" && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test PORT="$LMS_PORT" DATABASE_URL="$MONGO/lms_time_off_e2e" \
  JWT_ACCESS_SECRET="mentor-time-off-e2e-access-secret-0123456789" JWT_REFRESH_SECRET="mentor-time-off-e2e-refresh-secret-0123456789" \
  SALES_CRM_SECRET="$SECRET" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" EMAIL_FROM="" \
  bun --no-env-file src/index.ts > "$WORK/lms.log" 2>&1 & )

export MONGO_URI="$MONGO" MONGO_DB="commission_time_off_e2e" E2E_LMS_DB="lms_time_off_e2e" \
  JWT_SECRET="mentor-time-off-e2e-secret-0123456789abcdef" PORT="$API_PORT" E2E_API_PORT="$API_PORT" UPLOAD_DIR="$WORK/uploads" \
  LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="$SECRET" LMS_REMOTE_ORG_ID="$ORG" E2E_LMS_ORG="$ORG" HRMS_API_URL="" MENTOR_SCHEDULE_ALERTS=off \
  LMS_ACTIVITY=off LMS_ENROLMENT_SYNC=off FOLLOWUP_REMINDERS=off ONBOARDING_ALERTS=off WHATSAPP=off \
  SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && curl -s "http://127.0.0.1:$LMS_PORT/api/v1/service/roles" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
curl -s "http://127.0.0.1:$LMS_PORT/api/v1/service/roles" >/dev/null || { echo "--- lms log"; tail -30 "$WORK/lms.log"; exit 1; }
if ! bun --no-env-file src/scripts/mentor-time-off-e2e.ts; then echo "--- api log"; tail -20 "$WORK/api.log"; echo "--- lms log"; tail -30 "$WORK/lms.log"; exit 1; fi
