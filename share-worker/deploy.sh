#!/usr/bin/env bash
# Deploy worker.js to Cloudflare Workers through the REST API. No wrangler, no
# node_modules: it is one file and two curls.
#
# Credentials come from a file OUTSIDE this repo and are never printed:
#   CF_ENV=/path/to/cloudflare.env ./share-worker/deploy.sh
# expecting CF_ACCOUNT_ID, CF_API_TOKEN and (for the second call) CF_SUBDOMAIN.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="${SCRIPT_NAME:-sb-share}"
CF_ENV="${CF_ENV:-$HOME/.vibecon-secrets/cloudflare.env}"

# shellcheck disable=SC1090
set -a; source "$CF_ENV"; set +a
: "${CF_ACCOUNT_ID:?}" "${CF_API_TOKEN:?}"

API="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME"

# 1. Upload. A module worker is a multipart body: a `metadata` part naming the
#    entry module, plus the module itself as application/javascript+module.
curl -sS -X PUT "$API" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata={\"main_module\":\"worker.js\",\"compatibility_date\":\"2026-08-01\"};type=application/json" \
  -F "worker.js=@$HERE/worker.js;type=application/javascript+module" \
  | tr ',' '\n' | grep -E '"success"|"errors"' || true

# 2. Route it on workers.dev. Idempotent — enabling an already-enabled
#    subdomain is a no-op.
curl -sS -X POST "$API/subdomain" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'content-type: application/json' \
  --data '{"enabled":true}' \
  | tr ',' '\n' | grep -E '"success"|"errors"' || true

echo "→ https://$SCRIPT_NAME.${CF_SUBDOMAIN:-workers.dev}/?s=12437&k=9&d=2&m=g"
