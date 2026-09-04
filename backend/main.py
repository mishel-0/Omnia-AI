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

from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import traceback

from backend.version import __version__
from backend import audit
from datetime import datetime, timezone

app = FastAPI(title="Omnia AI — Pathology Clinical Trial Suite", version=__version__)

# The app's own frontend is the only legitimate browser origin. With
# allow_origins=["*"] Starlette echoes back whatever Origin it is given, so
# any web page the user happened to have open could call the endpoints that
# do not require a session — including /api/users/bootstrap, which creates
# an admin account while none exists. Naming the origins removes that.
#
# OMNIA_CORS_ORIGINS (comma-separated) covers running the frontend on a
# non-default port during development.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins = [
    o.strip()
    for o in os.environ.get("OMNIA_CORS_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ─── Health ───
@app.get("/health")
async def health():
    """Liveness probe. Deliberately `async` — a sync handler is dispatched to
    the same worker threadpool that slide analysis occupies, so while a
    CPU-bound analysis is running this could be slow enough to exceed the
    desktop shell's health-check timeout and make a perfectly healthy
    backend look dead. Running on the event loop keeps it answerable
    regardless of what the analysis workers are doing. Keep it free of any
    blocking work for the same reason."""
    from backend import testmode

    payload = {"status": "ok", "service": "omnia-pathology", "version": __version__,
               "time": datetime.now(timezone.utc).isoformat()}
    # Reported on the liveness probe specifically because that is the one
    # endpoint everything already calls. A build that fabricates grades
    # should never be able to look ordinary to anything checking on it.
    fabricated = testmode.warning()
    if fabricated:
        payload["grading_fabricated"] = True
        payload["warning"] = fabricated
    return payload

@app.get("/api/system/workers")
def system_workers():
    """Health of the background workers that keep the system in repair.

    Exposed so the application can report its own condition. A component that
    fails silently and leaves the app looking healthy is the failure mode this
    endpoint exists to prevent.
    """
    from backend.workers import supervisor
    return supervisor.status()


@app.post("/api/system/workers/{name}/run")
def run_worker(name: str):
    """Run one background check immediately instead of waiting for its next
    scheduled pass. Used by the maintenance screen's "run now" action."""
    from backend.workers import supervisor
    try:
        return supervisor.run_now(name)
    except KeyError:
        raise HTTPException(404, f"No background task named '{name}'")


@app.get("/api/system/preflight")
def preflight(authorization: str | None = Header(None)):
    """Real environment checks, run at install time.

    Open only while the installation has no account yet — the setup wizard
    genuinely cannot authenticate, because the first user does not exist. Once
    setup is complete this needs a session: the reply carries absolute
    filesystem paths and a per-dependency map of the machine, which is
    reconnaissance rather than something an anonymous caller needs.

    This replaced a fixed-duration progress animation that claimed to
    "verify package integrity" and "register file associations" while doing
    neither. In a clinical tool, a reassuring bar that checks nothing is
    worse than no bar: it tells an installer the environment is sound when
    nobody looked. Every entry below is an actual probe, and a failure here
    is a genuine reason the app will not grade slides on this machine.
    """
    import shutil
    from backend.users import any_users_exist
    from backend.deps import get_optional_user

    if any_users_exist() and not get_optional_user(authorization):
        raise HTTPException(401, "Not authenticated")

    checks = []

    def add(key, label, ok, detail, fatal=False):
        checks.append({"key": key, "label": label, "ok": bool(ok),
                       "detail": detail, "fatal": bool(fatal)})

    # Fabricated grading, first and fatal. If this is on, nothing else in
    # this list matters: the model is not being run at all.
    from backend import testmode
    if testmode.warning():
        add("grading_mode", "Grading uses the real model", False,
            "TEST MODE — grades are fabricated, not produced by the model", fatal=True)

    # Writable data directory — without it nothing can be saved at all.
    try:
        from backend.trials import DATA_DIR
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        probe = DATA_DIR / ".preflight"
        probe.write_text("ok")
        probe.unlink()
        add("storage", "Local data directory writable", True, str(DATA_DIR), fatal=True)
    except Exception as e:
        add("storage", "Local data directory writable", False, str(e), fatal=True)

    # Free disk. Whole-slide images are large; a nearly-full disk fails at
    # upload time rather than here, which is a confusing place to discover it.
    try:
        from backend.trials import DATA_DIR
        free_gb = shutil.disk_usage(DATA_DIR).free / (1024 ** 3)
        add("disk", "Free disk space", free_gb >= 5,
            f"{free_gb:.1f} GB available" + ("" if free_gb >= 5 else " — slides are 50 MB–2 GB each"))
    except Exception as e:
        add("disk", "Free disk space", False, str(e))

    # Whole-slide image support (native OpenSlide library).
    try:
        import openslide  # noqa: F401
        add("openslide", "Whole-slide image support", True,
            f"OpenSlide {getattr(openslide, '__version__', 'available')}", fatal=True)
    except Exception as e:
        add("openslide", "Whole-slide image support", False,
            f"Cannot read .svs files: {e}", fatal=True)

    # The grading model file itself.
    try:
        from backend.grading_model import MODEL_PATH
        exists = MODEL_PATH.exists()
        size = MODEL_PATH.stat().st_size / (1024 ** 2) if exists else 0
        add("model", "Grading model present", exists,
            f"{size:.0f} MB" if exists else f"Not found at {MODEL_PATH}", fatal=True)
    except Exception as e:
        add("model", "Grading model present", False, str(e), fatal=True)

    # Inference runtime.
    try:
        import torch
        add("torch", "Inference runtime", True, f"PyTorch {torch.__version__}", fatal=True)
    except Exception as e:
        add("torch", "Inference runtime", False, str(e), fatal=True)

    # Cheminformatics is optional: the app grades slides fine without it,
    # only the investigational-product chemistry panel degrades.
    try:
        import rdkit  # noqa: F401
        add("rdkit", "Compound chemistry support", True, f"RDKit {rdkit.__version__}")
    except Exception:
        add("rdkit", "Compound chemistry support", False,
            "Optional — drug structure descriptors will be unavailable")

    fatal_failed = [c for c in checks if c["fatal"] and not c["ok"]]
    return {
        "version": __version__,
        "checks": checks,
        "ready": not fatal_failed,
        "blocking_failures": [c["label"] for c in fatal_failed],
    }


# ─── Global exception handler ───
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log the full detail server-side, but never return internals (filesystem
    # paths, tracebacks) to the client unless explicitly debugging.
    logger.error(f"Unhandled error: {exc}\n{traceback.format_exc()}")
    if os.environ.get("DEBUG"):
        return JSONResponse(status_code=500, content={"error": str(exc), "detail": traceback.format_exc()})
    return JSONResponse(status_code=500, content={"error": "Internal server error"})

@app.middleware("http")
async def _record_request_origin(request, call_next):
    """Tell the audit trail where the request being served came from.

    Deliberately reads request.client.host and not X-Forwarded-For. This
    service binds to loopback by default and is meant to run on the
    controller's own hardware; honouring a forwarding header here would let any
    caller choose the address written into an audit record, which turns the one
    field that attributes an action into the easiest field to falsify.
    """
    try:
        audit.set_request_ip(request.client.host if request.client else "")
    except Exception:
        # Auditing must never break a request.
        pass
    return await call_next(request)


# ─── Include Routers ─────────────────────────────────────────────────────
from backend.routes import (
    license_router, trials_router, reports_router, analysis_router,
    users_router, audit_router, queries_router, training_router,
    patients_router, batch_router, gdpr_router, support_router,
)

app.include_router(license_router)
app.include_router(users_router)
app.include_router(trials_router)
app.include_router(patients_router)
app.include_router(reports_router)
app.include_router(analysis_router)
app.include_router(audit_router)
app.include_router(queries_router)
app.include_router(training_router)
app.include_router(batch_router)
app.include_router(gdpr_router)
app.include_router(support_router)

# A run recorded as "running" cannot have survived a restart — settle those now.
try:
    from backend.training import reconcile_interrupted_runs
    reconcile_interrupted_runs()
except Exception as e:
    logger.warning(f"Could not reconcile interrupted training runs: {e}")

logger.info("Pathology routers registered. Omnia AI ready.")


@app.on_event("startup")
def _warm_grading_model():
    """Load the grading model in the background at boot.

    Cold-loading torch plus the checkpoint takes ~20s; done lazily, the
    first pathologist to analyse a slide after every launch pays it. Run
    off the event loop so the server still binds and serves /health
    immediately — the desktop shell polls that to decide the app is up,
    and blocking startup on model load would stall the splash screen.
    """
    import threading
    from backend.grading_model import warmup
    threading.Thread(target=warmup, name="model-warmup", daemon=True).start()


@app.on_event("startup")
def _start_background_workers():
    """Start the supervised background workers.

    These own the recurring repair and housekeeping work that previously had
    no owner — interrupted training runs, leftover partial files, unbounded
    caches, a grading model that failed to load. See backend/workers.py.
    """
    from backend.workers import build_default_workers
    build_default_workers().start()


@app.on_event("startup")
def _start_batch_queue():
    """Resume the batch queue, including anything a previous process left
    mid-flight. Slides interrupted by a restart go back to pending rather
    than being silently dropped from the cohort."""
    from backend import batch
    batch.start()


@app.on_event("shutdown")
def _stop_background_workers():
    from backend.workers import supervisor
    supervisor.stop()
    from backend import batch
    batch.stop()

# ─── Main Entrypoint ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    reload = os.environ.get("OMNIA_DEV_RELOAD") == "true"

    # Loopback only. This process serves patient data and, before the first
    # account exists, an unauthenticated endpoint that creates an admin
    # (/api/users/bootstrap) — binding 0.0.0.0 published both to every
    # interface on the machine, so any device on a hospital LAN or guest
    # Wi-Fi could reach them. Nothing needs off-machine access: Electron
    # health-checks 127.0.0.1, the frontend calls localhost, and the
    # bundled Next.js server is already pinned to 127.0.0.1.
    #
    # OMNIA_BIND_HOST exists for containerised deployments where the
    # process must answer outside its own network namespace. Setting it is
    # a deliberate act that exposes the API, and the startup banner says so.
    host = os.environ.get("OMNIA_BIND_HOST", "127.0.0.1")
    if host != "127.0.0.1":
        logger.warning(
            "Binding to %s, not loopback. The API — including unauthenticated "
            "setup while no account exists — is reachable from other machines. "
            "Ensure something in front of it restricts access.", host,
        )

    if reload:
        uvicorn.run("backend.main:app", host=host, port=port, reload=True)
    else:
        uvicorn.run(app, host=host, port=port)
