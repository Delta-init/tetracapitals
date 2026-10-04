#!/usr/bin/env bash
# ./test-mentor-hours.sh — the mentors' working hours from the HRMS on the Mentor Calendar, end to end: a throwaway
# mongod, this API and the real HRMS (beside this repository at ../../hrms/hrms-backend, or HRMS_BACKEND) — none of
# them reading a .env. The HRMS loads dotenv itself, so it runs from the scratch folder with an empty one, and from a
# clean environment. Tears everything down afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HRMS_BACKEND="${HRMS_BACKEND:-$HERE/../../hrms/hrms-backend}"
[ -f "$HRMS_BACKEND/src/index.ts" ] || { echo "No HRMS backend at $HRMS_BACKEND (set HRMS_BACKEND)" >&2; exit 1; }
MONGO_PORT="${E2E_MONGO_PORT:-27092}"; API_PORT="${E2E_API_PORT:-4157}"; HRMS_PORT="${E2E_HRMS_PORT:-4158}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4159}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mentor-hours-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT" "$HRMS_PORT" "$LMS_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT" "$HRMS_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
: > "$WORK/empty.env"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
MONGO="mongodb://127.0.0.1:$MONGO_PORT"
CLIENT="mentor-hours-e2e-client"; SECRET="mentor-hours-e2e-integration-secret-0123456789"

# A checkout without web-push installed (push notifications, nothing this test touches) gets a stand-in for it.
PRELOAD=()
if [ ! -d "$HRMS_BACKEND/node_modules/web-push" ]; then
  cat > "$WORK/web-push-stand-in.ts" <<'TS'
import { plugin } from "bun";
plugin({ name: "web-push stand-in", setup(build) {
  build.module("web-push", () => ({ exports: { default: { setVapidDetails() {}, async sendNotification() { return {}; } } }, loader: "object" }));
} });
TS
  PRELOAD=(--preload "$WORK/web-push-stand-in.ts")
fi
# The HRMS: scratch database, its own signed client, nothing from its .env.
( cd "$WORK" && env -i PATH="$PATH" HOME="$HOME" DOTENV_CONFIG_PATH="$WORK/empty.env" NODE_ENV=test PORT="$HRMS_PORT" \
  MONGODB_URI="$MONGO/hrms_mentor_hours_e2e" JWT_SECRET="mentor-hours-e2e-jwt-secret-0123456789abcdef" \
  JWT_REFRESH_SECRET="mentor-hours-e2e-refresh-secret-0123456789abcdef" SUPER_ADMIN_EMAIL="admin@hrms-e2e.test" \
  SUPER_ADMIN_PASSWORD="Password123!" INTEGRATION_CLIENT_ID="$CLIENT" INTEGRATION_SECRET="$SECRET" \
  bun --no-env-file "${PRELOAD[@]}" "$HRMS_BACKEND/src/index.ts" > "$WORK/hrms.log" 2>&1 & )

export MONGO_URI="$MONGO" MONGO_DB="commission_mentor_hours_e2e" E2E_HRMS_DB="hrms_mentor_hours_e2e" \
  JWT_SECRET="mentor-hours-e2e-secret-0123456789abcdef" PORT="$API_PORT" E2E_API_PORT="$API_PORT" UPLOAD_DIR="$WORK/uploads" \
  E2E_FAKE_LMS_PORT="$LMS_PORT" LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="mentor-hours-e2e-lms-secret-0123456789" \
  HRMS_API_URL="http://127.0.0.1:$HRMS_PORT/api/v1" HRMS_CLIENT_ID="$CLIENT" HRMS_INTEGRATION_SECRET="$SECRET" HRMS_ORG_ID="" \
  LMS_ACTIVITY=off LMS_ENROLMENT_SYNC=off FOLLOWUP_REMINDERS=off ONBOARDING_ALERTS=off WHATSAPP=off \
  SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 80); do
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && curl -s "http://127.0.0.1:$HRMS_PORT/api/v1/integrations/ping" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
curl -s "http://127.0.0.1:$HRMS_PORT/api/v1/integrations/ping" >/dev/null || { echo "--- hrms log"; tail -30 "$WORK/hrms.log"; exit 1; }
if ! bun --no-env-file src/scripts/mentor-hours-e2e.ts; then echo "--- api log"; tail -20 "$WORK/api.log"; echo "--- hrms log"; tail -20 "$WORK/hrms.log"; exit 1; fi
