#!/usr/bin/env bash
# End-to-end test of merging two student records (students/merge.ts): finding, preview, the merge, the lookups finance
# and the LMS use, undo, a merge stopped part-way. A throwaway mongod and the API, no .env; nothing leaves this machine.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27137}"; API_PORT="${E2E_API_PORT:-4197}"; FINANCE_PORT="${E2E_FAKE_FINANCE_PORT:-4198}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4199}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/student-merge-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT" "$FINANCE_PORT" "$LMS_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT" "$FINANCE_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_student_merge_e2e" JWT_SECRET="student-merge-e2e-secret-0123456789abcdef" \
  PORT="$API_PORT" E2E_API_PORT="$API_PORT" E2E_FAKE_FINANCE_PORT="$FINANCE_PORT" UPLOAD_DIR="$WORK/uploads" \
  FINANCE_S2S_SECRET="student-merge-e2e-shared-secret-0123456789" LMS_S2S_SECRET="student-merge-e2e-lms-secret-0123456789" \
  FINANCE_API_URL="http://127.0.0.1:$FINANCE_PORT" FINANCE_CLIENT_ID="tetra-commission-e2e" \
  FINANCE_INTEGRATION_SECRET="student-merge-e2e-inbound-secret-0123456789" FINANCE_ORG_ID="64b000000000000000000042" \
  ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="student-merge-e2e-lms-service-0123456789" E2E_FAKE_LMS_PORT="$LMS_PORT" MERGE_LMS_SYNC=off \
  LMS_CS_SYNC=off LMS_ACTIVITY=off LMS_ENROLMENT_SYNC=off FOLLOWUP_REMINDERS=off ONBOARDING_ALERTS=off WHATSAPP=off MENTOR_SCHEDULE_ALERTS=off \
  BALANCE_REMINDERS=off VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY="" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY="" THREECX_URL=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
if ! bun --no-env-file src/scripts/student-merge-e2e.ts; then echo "--- api log"; tail -40 "$WORK/api.log"; exit 1; fi
