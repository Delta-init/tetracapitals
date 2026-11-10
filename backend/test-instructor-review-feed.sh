#!/usr/bin/env bash
# ./test-instructor-review-feed.sh — Instructor Reviews: All reviews and the filters, on made-up staff in a throwaway
# mongod; nothing reads a .env. Tears everything down.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_PORT="${E2E_MONGO_PORT:-27102}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/instructor-review-feed-e2e.XXXXXX")"
release() { local pids; pids="$(lsof -nP -t -iTCP:"$MONGO_PORT" -sTCP:LISTEN 2>/dev/null || true)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true; }
cleanup() { local code=$?; release; sleep 1; rm -rf "$WORK"; exit $code; }
trap cleanup EXIT INT TERM
lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $MONGO_PORT busy" >&2; exit 1; }
mkdir -p "$WORK/db" "$WORK/home"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null
export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_DB="commission_instructor_review_feed_e2e" HOME="$WORK/home" \
  JWT_SECRET="lms-mentor-meetings-e2e-secret-0123456789" FINANCE_API_URL="" ROOT_ERP_API_URL="" LMS_SERVICE_SECRET="e2e-lms-service-secret" LMS_S2S_SECRET="e2e-lms-s2s-secret" MEETING_REQUEST_REMINDERS=off SMTP_HOST=""
cd "$HERE"
bun --no-env-file src/scripts/instructor-review-feed-e2e.ts
