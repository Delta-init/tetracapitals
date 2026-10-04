#!/usr/bin/env bash
# ./test-bonus-verification.sh — onboarding verification (the sales-close MT5 bonus, Submit again, finance's lookup, the reminder),
# end to end: throwaway mongod and the API — neither reading a .env. Tears everything down afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27092}"; API_PORT="${E2E_API_PORT:-4162}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bonus-verification-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT" "$MONGO_PORT"; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_bonus_verification_e2e" JWT_SECRET="bonus-verification-e2e-secret-0123456789abcdef" \
  PORT="$API_PORT" E2E_API_PORT="$API_PORT" UPLOAD_DIR="$WORK/uploads" \
  FINANCE_API_URL="" FINANCE_CLIENT_ID="" FINANCE_INTEGRATION_SECRET="" FINANCE_S2S_SECRET="bonus-verification-e2e-shared-secret-0123456789" ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" \
  LMS_API_URL="" LMS_SERVICE_SECRET="" LMS_ACTIVITY=off LMS_ENROLMENT_SYNC=off FOLLOWUP_REMINDERS=off ONBOARDING_ALERTS=off WHATSAPP=off \
  SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
if ! bun --no-env-file src/scripts/bonus-verification-e2e.ts; then echo "--- api log"; tail -30 "$WORK/api.log"; exit 1; fi
