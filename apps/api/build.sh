#!/usr/bin/env bash
# Vercel build step for the API project.
# 1. Python deps: export uv.lock to requirements.txt (Vercel's Python runtime
#    installs requirements.txt natively; uv itself is not available there).
# 2. Install the pi coding agent (npm) into a trimmed node_modules so the
#    playground runner can spawn it from a serverless function:
#    - 250MB lambda limit: drop esbuild (284MB, build tooling only) + typescript
#    - runtime deps stay: cli.js + provider SDKs (~167MB)
# 3. Copy the control-layer extension, schema and seed policy into the project
#    dir (packages/pi-control-layer lives outside apps/api and is not uploaded).
set -euo pipefail
cd "$(dirname "$0")"

# python deps (uv export requires uv; Vercel's runtime provides pip)
if command -v uv >/dev/null 2>&1; then
  uv export --no-dev --format requirements.txt --output-file requirements.txt --quiet
else
  pip install --quiet uv
  uv export --no-dev --format requirements.txt --output-file requirements.txt --quiet
fi

export NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
npm install @earendil-works/pi-coding-agent@0.85.1 --prefix . --no-save --loglevel=error

PKG="node_modules/@earendil-works/pi-coding-agent"
rm -rf "$PKG/node_modules/@esbuild" "$PKG/node_modules/typescript" "$PKG/node_modules/@types"

# vendor the control layer into the function bundle
mkdir -p pi-control-layer
cp ../packages/pi-control-layer/control-layer.ts pi-control-layer/
cp ../packages/pi-control-layer/policy.schema.json pi-control-layer/
cp ../packages/pi-control-layer/policy.json.example pi-control-layer/

du -sh node_modules 2>/dev/null || true
