"""Omnia AI Backend Server — Pathology Clinical Trial Suite."""
from __future__ import annotations
import os
import sys
import logging

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

from dotenv import load_dotenv
load_dotenv(os.path.join(_root, ".env.local"))
load_dotenv(os.path.join(_root, ".env"))

logger = logging.getLogger("omnia-pathology")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import traceback
from datetime import datetime, timezone

app = FastAPI(title="Omnia AI — Pathology Clinical Trial Suite", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Health ───
@app.get("/health")
def health():
    return {"status": "ok", "service": "omnia-pathology", "version": "1.0.0", "time": datetime.now(timezone.utc).isoformat()}

# ─── Global exception handler ───
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log the full detail server-side, but never return internals (filesystem
    # paths, tracebacks) to the client unless explicitly debugging.
    logger.error(f"Unhandled error: {exc}\n{traceback.format_exc()}")
    if os.environ.get("DEBUG"):
        return JSONResponse(status_code=500, content={"error": str(exc), "detail": traceback.format_exc()})
    return JSONResponse(status_code=500, content={"error": "Internal server error"})

# ─── Include Routers ─────────────────────────────────────────────────────
from backend.routes import (
    license_router, trials_router, reports_router, analysis_router,
    users_router, audit_router, queries_router, training_router,
)

app.include_router(license_router)
app.include_router(users_router)
app.include_router(trials_router)
app.include_router(reports_router)
app.include_router(analysis_router)
app.include_router(audit_router)
app.include_router(queries_router)
app.include_router(training_router)

# A run recorded as "running" cannot have survived a restart — settle those now.
try:
    from backend.training import reconcile_interrupted_runs
    reconcile_interrupted_runs()
except Exception as e:
    logger.warning(f"Could not reconcile interrupted training runs: {e}")

logger.info("Pathology routers registered. Omnia AI ready.")

# ─── Main Entrypoint ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    reload = os.environ.get("OMNIA_DEV_RELOAD") == "true"
    if reload:
        uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
    else:
        uvicorn.run(app, host="0.0.0.0", port=port)
