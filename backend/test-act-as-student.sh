#!/usr/bin/env bash
# ./test-act-as-student.sh — "Act as student" read & write, against a stand-in LMS on made-up people:
# throwaway mongod, nothing reading a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27102}"; LMS_PORT="${E2E_FAKE_LMS_PORT:-4151}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-as-student-e2e.XXXXXX")"
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$LMS_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_act_as_student_e2e" E2E_FAKE_LMS_PORT="$LMS_PORT" \
  LMS_API_URL="http://127.0.0.1:$LMS_PORT" LMS_SERVICE_SECRET="act-as-student-e2e-secret" LMS_REMOTE_ORG_ID="e2e-org" \
  VAPID_PUBLIC_KEY="" VAPID_PRIVATE_KEY="" SMTP_HOST="" SMTP_USER="" SMTP_PASS=""
cd "$HERE"
bun --no-env-file src/scripts/act-as-student-e2e.ts
