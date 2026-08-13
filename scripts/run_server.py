#!/usr/bin/env python3
"""
Omnia-AI Server Process Manager
================================
Handles clean startup/shutdown of both backend and frontend servers.
Auto-detects venv, installs dependencies if missing.
Monitors backend health and auto-restarts on failure (up to 3 retries).
"""

import sys
import time
import signal
import logging
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent  # scripts/../ = project root
BACKEND_PORT = 8000
FRONTEND_PORT = 3000
HEALTH_URL = f"http://localhost:{BACKEND_PORT}/health"
HEALTH_INTERVAL = 5  # seconds
MAX_RETRIES = 3

# ── Logging ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("run_server")


# ── Venv auto-detection & setup ───────────────────────────────────────────

def _resolve_python() -> str:
    """Find the project Python (venv preferred), create + install if missing."""
    venv_candidates = [
        PROJECT_ROOT / ".venv" / "bin" / "python",
        PROJECT_ROOT / "venv" / "bin" / "python",
    ]
    for venv_python in venv_candidates:
        if venv_python.is_file():
            log.info(f"Using venv Python: {venv_python}")
            return str(venv_python)

    # No venv found — create one
    log.info("No venv found. Creating .venv...")
    subprocess.run(
        [sys.executable, "-m", "venv", str(PROJECT_ROOT / ".venv")],
        check=True, cwd=str(PROJECT_ROOT),
    )
    venv_python = PROJECT_ROOT / ".venv" / "bin" / "python"
    log.info(f"Created .venv at {venv_python}")

    # Install requirements
    req_file = PROJECT_ROOT / "requirements.txt"
    if req_file.is_file():
        log.info("Installing dependencies from requirements.txt...")
        subprocess.run(
            [str(venv_python), "-m", "pip", "install", "-q", "-r", str(req_file)],
            check=True, cwd=str(PROJECT_ROOT),
        )
        log.info("Dependencies installed.")
    else:
        log.warning("No requirements.txt found — skipping pip install.")

    return str(venv_python)


def _resolve_frontend_cmd() -> list:
    """Use 'next start' (production) if out/ exists, otherwise 'next dev'."""
    out_dir = PROJECT_ROOT / "out"
    if out_dir.is_dir() and any(out_dir.iterdir()):
        log.info("Production build found — using 'next start'")
        return ["npx", "next", "start", "-p", str(FRONTEND_PORT)]
    log.info("No production build — using 'next dev'")
    return ["npx", "next", "dev", "-p", str(FRONTEND_PORT)]


# ── Process manager ───────────────────────────────────────────────────────

class ServerManager:
    def __init__(self):
        self.backend_proc: subprocess.Popen | None = None
        self.frontend_proc: subprocess.Popen | None = None
        self.retry_count = 0
        self.shutting_down = False
        self._original_sigint = None
        self._original_sigterm = None
        self._python_path = _resolve_python()
        self._backend_cmd = [self._python_path, "run_backend.py"]
        self._frontend_cmd = _resolve_frontend_cmd()

    def _start_backend(self):
        """Start the backend server process."""
        log.info("Starting backend server...")
        log.info(f"  Command: {' '.join(self._backend_cmd)}")
        self.backend_proc = subprocess.Popen(
            self._backend_cmd,
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        log.info(f"Backend started (PID: {self.backend_proc.pid})")
        self.retry_count = 0

    def _start_frontend(self):
        """Start the frontend server process."""
        log.info("Starting frontend server...")
        log.info(f"  Command: {' '.join(self._frontend_cmd)}")
        self.frontend_proc = subprocess.Popen(
            self._frontend_cmd,
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        log.info(f"Frontend started (PID: {self.frontend_proc.pid})")

    def _check_health(self) -> bool:
        """Return True if the backend health endpoint responds OK."""
        try:
            req = urllib.request.Request(HEALTH_URL, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except (urllib.error.URLError, urllib.error.HTTPError, OSError):
            return False

    def _kill(self, proc, name):
        """Gracefully kill a process, then force if needed."""
        if proc is None:
            return
        try:
            log.info(f"Stopping {name} (PID: {proc.pid})...")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                log.warning(f"{name} did not terminate in time, force-killing...")
                proc.kill()
                proc.wait(timeout=3)
            log.info(f"{name} stopped.")
        except ProcessLookupError:
            pass  # already dead

    def _shutdown(self):
        """Graceful full shutdown."""
        if self.shutting_down:
            return
        self.shutting_down = True
        log.info("Shutting down all servers...")
        self._kill(self.frontend_proc, "frontend")
        self._kill(self.backend_proc, "backend")
        log.info("All servers stopped.")

    def _log_stream(self, proc, prefix):
        """Read any available output from a process stream."""
        if proc is None or proc.stdout is None:
            return
        try:
            for line in iter(proc.stdout.readline, ""):
                if line:
                    log.info(f"[{prefix}] {line.rstrip()}")
                else:
                    break
        except ValueError:
            pass  # stream closed

    def _restart_backend(self):
        """Restart the backend if retries remain."""
        self.retry_count += 1
        if self.retry_count > MAX_RETRIES:
            log.error(
                f"Backend failed {MAX_RETRIES} times consecutively. "
                "Giving up auto-restart."
            )
            return
        log.warning(
            f"Backend health check failed. "
            f"Restarting... (attempt {self.retry_count}/{MAX_RETRIES})"
        )
        self._kill(self.backend_proc, "backend")
        time.sleep(1)
        self._start_backend()

    def _poll_streams(self):
        """Non-blocking read of stdout for both processes."""
        self._log_stream(self.backend_proc, "backend")
        self._log_stream(self.frontend_proc, "frontend")

    def run(self):
        """Main loop: start both servers, monitor health, restart on failure."""
        # Install signal handlers
        self._original_sigint = signal.getsignal(signal.SIGINT)
        self._original_sigterm = signal.getsignal(signal.SIGTERM)

        def _handle_signal(signum, frame):
            log.info(f"Received signal {signum}, shutting down...")
            self._shutdown()
            sys.exit(0)

        signal.signal(signal.SIGINT, _handle_signal)
        signal.signal(signal.SIGTERM, _handle_signal)

        # Start servers
        self._start_backend()
        time.sleep(2)  # brief wait for backend to initialize
        self._start_frontend()

        log.info("Both servers launched. Starting health monitor...")

        health_fail_count = 0
        consecutive_failures = 0

        try:
            while not self.shutting_down:
                # Poll stdout from processes
                self._poll_streams()

                # Check if backend process died
                if self.backend_proc and self.backend_proc.poll() is not None:
                    log.warning("Backend process exited unexpectedly.")
                    self._restart_backend()
                    health_fail_count = 0
                    consecutive_failures = 0
                    time.sleep(HEALTH_INTERVAL)
                    continue

                # Health check
                healthy = self._check_health()
                if healthy:
                    if consecutive_failures > 0:
                        log.info("Backend health recovered.")
                    consecutive_failures = 0
                    health_fail_count = 0
                else:
                    consecutive_failures += 1
                    health_fail_count += 1
                    log.warning(
                        f"Health check failed ({consecutive_failures} consecutive)..."
                    )
                    if consecutive_failures >= 3:
                        self._restart_backend()
                        consecutive_failures = 0
                        time.sleep(2)

                time.sleep(HEALTH_INTERVAL)

        except KeyboardInterrupt:
            self._shutdown()
        except Exception as exc:
            log.exception(f"Unexpected error: {exc}")
            self._shutdown()


# ── Entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    manager = ServerManager()
    manager.run()
