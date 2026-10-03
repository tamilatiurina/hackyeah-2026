#!/usr/bin/env bash
# Point the API and web app at the local Supabase stack and make sure a demo user exists.
# Writes apps/api/.env, apps/web/.env.local and apps/api/supabase/.env.demo (all gitignored).
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

demo=apps/api/supabase/.env.demo
if [[ ! -f $demo ]]; then
  password="demo-$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')"
  printf '# Local demo user for the web sign-in (local Supabase only).\nDEMO_EMAIL=demo@guardrail.local\nDEMO_PASSWORD=%s\n' "$password" > $demo
fi
# shellcheck disable=SC1090
source $demo
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/auth/v1/signup" \
  -H "apikey: $PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")
case $code in
  200) echo "Created demo user $DEMO_EMAIL (password in $demo)" ;;
  422) echo "Demo user $DEMO_EMAIL already exists (password in $demo)" ;;
  *) echo "Could not create the demo user (HTTP $code)" >&2; exit 1 ;;
esac
echo "Wrote apps/api/.env and apps/web/.env.local. Studio: http://127.0.0.1:54323"
