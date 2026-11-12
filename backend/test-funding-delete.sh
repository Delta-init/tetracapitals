#!/usr/bin/env bash
# ./test-funding-delete.sh — deleting a pending or rejected funding request, here and from Delta Finance. Throwaway mongod,
# the API, and a stand-in finance served by the test itself — nothing reading a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27133}"; API_PORT="${E2E_API_PORT:-4171}"; FINANCE_PORT="${E2E_FAKE_FINANCE_PORT:-4172}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/funding-delete-e2e.XXXXXX")"
release() { local p; for p in "$@"; do local pids; pids="$(lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; done; }
cleanup() { local code=$?; release "$API_PORT" "$FINANCE_PORT"; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; sleep 1; release "$MONGO_PORT"; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
for p in "$MONGO_PORT" "$API_PORT" "$FINANCE_PORT"; do lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy" >&2; exit 1; }; done
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_funding_delete_e2e" JWT_SECRET="finance-withdrawal-e2e-secret-0123456789abcdef" \
  PORT="$API_PORT" E2E_API_PORT="$API_PORT" E2E_FAKE_FINANCE_PORT="$FINANCE_PORT" UPLOAD_DIR="$WORK/uploads" \
  FINANCE_S2S_SECRET="finance-withdrawal-e2e-decision-secret-0123456789" \
  FINANCE_API_URL="http://127.0.0.1:$FINANCE_PORT" FINANCE_CLIENT_ID="tetra-commission-e2e" \
  FINANCE_INTEGRATION_SECRET="finance-withdrawal-e2e-inbound-secret-0123456789" FINANCE_ORG_ID="64b000000000000000000042" FINANCE_ORG_ID_BANGALORE="64b000000000000000000043" \
  ROOT_ERP_API_URL="" ROOT_ERP_SECRET="" SMTP_HOST="" SMTP_USER="" SMTP_PASS="" ANTHROPIC_API_KEY=""
cd "$HERE"
bun --no-env-file src/index.ts > "$WORK/api.log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$WORK/api.log"; exit 1; }
if ! bun --no-env-file src/scripts/funding-delete-e2e.ts; then echo "--- api log"; tail -40 "$WORK/api.log"; exit 1; fi
