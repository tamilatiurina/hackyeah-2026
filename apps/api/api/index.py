# Vercel Python runtime entrypoint: exposes the FastAPI app.
# The repo layout is kept intact (app.main:app); this shim only re-exports it.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402

handler = app  # noqa: F811 — Vercel looks for `app` in api/*.py
