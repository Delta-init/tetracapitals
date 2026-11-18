#!/usr/bin/env bash
# ./test-mailer-pool.sh — lib/mailer.ts through one kept-open SMTP connection, against a stand-in SMTP server.
# No database, nothing reads a .env.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bun --no-env-file src/scripts/mailer-pool-e2e.ts
