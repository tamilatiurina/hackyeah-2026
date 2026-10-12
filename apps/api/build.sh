#!/usr/bin/env bash
# Vercel build step for the API project (bash build.sh).
# 1. Export uv.lock to requirements.txt (the Vercel Python runtime installs
#    requirements.txt natively). uv may not exist on the build image; if the
#    export cannot run, fall back to the committed requirements.txt.
set -euo pipefail
cd "$(dirname "$0")"
echo "==> build.sh: pwd=$(pwd)"

echo "==> python requirements"
REQ_SRC=""
if command -v uv >/dev/null 2>&1; then
  echo "    uv found: $(uv --version)"
  if uv export --no-dev --format requirements.txt --output-file requirements.txt 2>&1; then
    REQ_SRC="uv export"
  else
    echo "    uv export failed; falling back"
  fi
else
  echo "    uv not on PATH"
fi
if [ -z "$REQ_SRC" ]; then
  # fallback: committed requirements.txt (from `uv export`, checked in) or empty stub
  if [ -f requirements.txt ]; then
    echo "    using committed requirements.txt"
    REQ_SRC="committed"
  else
    echo "    WARNING: no requirements.txt available — python deps rely on runtime detection"
    REQ_SRC="none"
  fi
fi
echo "    requirements source: $REQ_SRC ($(wc -l < requirements.txt 2>/dev/null || echo 0) lines)"

echo "==> build.sh complete"
