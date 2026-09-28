#!/usr/bin/env bash
# ./test-student-history.sh — who gets a new student, the team stored on them, and their history, end to end:
# throwaway mongod and the API — neither reading a .env. Tears everything down afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27096}"; API_PORT="${E2E_API_PORT:-4146}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/student-history-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT"; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; sleep 1; release "$MONGO_PORT"; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_student_history_e2e" JWT_SECRET="student-history-e2e-secret-0123456789abcdef" \
  PORT="$API_PORT" E2E_API_PORT="$API_PORT" UPLOAD_DIR="$WORK/uploads" \
  LMS_S2S_SECRET="student-history-e2e-lms-secret-0123456789" FINANCE_S2S_SECRET="" \
  ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
if ! bun --no-env-file src/scripts/student-history-e2e.ts; then echo "--- api log"; tail -30 "$WORK/api.log"; exit 1; fi
