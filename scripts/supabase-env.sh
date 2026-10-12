#!/usr/bin/env bash
# Point the API and web app at the local Supabase stack.
# Writes apps/api/.env and apps/web/.env.local (both gitignored). Create accounts on the sign-up page.
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE="pnpm dlx supabase@2.119.0"
status=$($SUPABASE status --workdir apps/api -o env 2>/dev/null)
API_URL=$(grep -E '^API_URL=' <<<"$status" | cut -d= -f2- | tr -d '"')
PUBLISHABLE_KEY=$(grep -E '^PUBLISHABLE_KEY=' <<<"$status" | cut -d= -f2- | tr -d '"')
if [[ -z "$API_URL" || -z "$PUBLISHABLE_KEY" ]]; then
  echo "Local Supabase is not running. Start it with: make supabase" >&2
  exit 1
fi

cat > apps/api/.env <<ENV
# Local Supabase (make supabase). Development keys only.
SUPABASE_URL=$API_URL
SUPABASE_KEY=$PUBLISHABLE_KEY
ENV

cat > apps/web/.env.local <<ENV
# Local Supabase (make supabase). Development keys only.
API_URL=http://localhost:8000
SUPABASE_URL=$API_URL
SUPABASE_KEY=$PUBLISHABLE_KEY
ENV

echo "Wrote apps/api/.env and apps/web/.env.local. Studio: http://127.0.0.1:54323, sign-up emails: http://127.0.0.1:54324"
