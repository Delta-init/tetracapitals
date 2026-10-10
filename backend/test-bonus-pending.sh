#!/usr/bin/env bash
# ./test-bonus-pending.sh — "Bonus pending" on the Students list and the student page (students/bonusPending.ts): each
# row's pending bonuses and where they wait, the Bonus filter with the other filters and tabs, a CS's scope — on
# made-up staff in a throwaway mongod; nothing reads a .env, nothing is sent to finance. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27104}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bonus-pending-e2e.XXXXXX")"
# macOS mongod has no --shutdown: stopped by its port as well.
release() { local pids; pids="$(lsof -nP -t -iTCP:"$MONGO_PORT" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; }
cleanup() { local code=$?; mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true; sleep 1; release; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $MONGO_PORT busy" >&2; exit 1; }
mkdir -p "$WORK/db"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="bonus_pending_e2e"
cd "$HERE"
HOME="$WORK" bun --no-env-file src/scripts/bonus-pending-e2e.ts
