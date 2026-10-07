#!/usr/bin/env bash
#
# Each student's CS and CS team, told to the Delta LMS — end to end
# (src/scripts/lms-cs-e2e.ts): a throwaway mongod and a stand-in LMS the test
# serves itself; the job is driven by the test, run by run. No .env is read.
#
#   ./test-lms-cs.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27099}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4149}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lms-cs-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
# mongod --shutdown does not exist on macOS: the mongod is stopped by its port.
cleanup() { local code=$?; release "$LMS_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_lms_cs_e2e" JWT_SECRET="lms-cs-e2e-secret-0123456789abcdef" \
  E2E_FAKE_LMS_PORT="$LMS_PORT" LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="lms-cs-e2e-service-secret-0123456789" \
  LMS_REMOTE_ORG_ID="" ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/scripts/lms-cs-e2e.ts
