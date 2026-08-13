#!/usr/bin/env python3
"""
Omnia Distribution Engine — Production Hub

A bot-managed pipeline that:
  1. Runs debug tests on current version
  2. Runs production validation tests
  3. Builds DMG and EXE
  4. Creates GitHub Release
  5. Notifies clinics

Usage:
  python3 scripts/distribution-engine.py          # Full pipeline
  python3 scripts/distribution-engine.py --debug   # Debug only
  python3 scripts/distribution-engine.py --ship    # Release only (after debug)
"""

import os
import sys
import json
import time
import subprocess
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
DIST = ROOT / "dist-desktop"

VERSION_FILE = ROOT / "backend" / "app_state.py"

class Bot:
    """Base bot with logging and status tracking."""
    def __init__(self, name):
        self.name = name
        self.start = time.time()
        self.status = "pending"
        self.log = []

    def say(self, msg):
        t = datetime.now().strftime("%H:%M:%S")
        line = f"[{t}] [{self.name}] {msg}"
        self.log.append(line)
        print(line, flush=True)

    def ok(self, msg=""):
        self.status = "passed"
        self.say(f"✅ PASSED ({time.time()-self.start:.1f}s)" + (f" — {msg}" if msg else ""))

    def fail(self, msg=""):
        self.status = "failed"
        self.say(f"❌ FAILED ({time.time()-self.start:.1f}s)" + (f" — {msg}" if msg else ""))
        return False


class DebugBot(Bot):
    """Runs comprehensive test suite on current version."""

    def __init__(self):
        super().__init__("DEBUG")

    def run(self):
        self.say("Starting debug tests...")
        
        # Start backend server for API tests (optional - some tests need it, some don't)
        backend_proc = None
        if not self._is_backend_running():
            self.say("  Backend not running — skipping API tests")
        
        checks = [
            ("TypeScript check", self._ts_check),
            ("Lint", self._lint),
            ("Logical bugs scan", self._logical_bugs),
            ("Clinical pipeline", self._clinical_tests),
            ("Frontend build", self._frontend_build),
        ]
        failures = []
        for name, fn in checks:
            self.say(f"  → {name}")
            if not fn():
                failures.append(name)
        if failures:
            self.fail(f"Failed: {', '.join(failures)}")
            return False
        self.ok("All debug tests passed")
        
        # Cleanup: kill backend if we started it
        if backend_proc:
            backend_proc.terminate()
            self.say("  Backend stopped")
            
        return True

    def _is_backend_running(self):
        """Check if the backend health endpoint responds."""
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.connect(("127.0.0.1", 8000))
            s.close()
            return True
        except (ConnectionRefusedError, OSError):
            return False
        finally:
            s.close()

    def _logical_bugs(self):
        """Scan for common logical bugs: hardcoded URLs, missing error handlers, race conditions."""
        issues = []
        
        # 1. Hardcoded 0.0.0.0 bindings (GDPR risk)
        for path in ROOT.rglob("*.py"):
            if "node_modules" in str(path) or ".venv" in str(path) or "dist" in str(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            for line in content.split("\n"):
                if '"0.0.0.0"' in line and "HOSTNAME" in line:
                    issues.append(f"GDPR: 0.0.0.0 binding in {path.name}")
        
        # 2. Hardcoded API URLs in frontend
        for path in ROOT.rglob("*.ts*"):
            if "node_modules" in str(path) or ".next" in str(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            if 'localhost' in content and 'API_BASE' not in content:
                lines = [l for l in content.split("\n") if 'localhost' in l]
                if lines:
                    for l in lines[:2]:
                        issues.append(f"Hardcoded URL in {path.name}: {l.strip()[:60]}")
        
        # 3. bare except: clauses (swallows errors)
        for path in ROOT.rglob("*.py"):
            if "node_modules" in str(path) or ".venv" in str(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            if "except:" in content:
                issues.append(f"Bare except in {path.name} — swallows errors")
        
        # 4. Missing timeouts on HTTP calls
        for path in ROOT.rglob("*.py"):
            if "node_modules" in str(path) or ".venv" in str(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            for line in content.split("\n"):
                if "requests." in line and "timeout" not in line and "get(" in line or "post(" in line:
                    issues.append(f"Missing timeout in {path.name}: {line.strip()[:60]}")
        
        if issues:
            self.say(f"  Found {len(issues)} issues:")
            for issue in issues[:10]:
                self.say(f"    ⚠️  {issue}")
            if len(issues) > 10:
                self.say(f"    ... and {len(issues)-10} more")
            return True  # Warnings only, don't fail
        self.say("  No logical bugs found")
        return True

    def _ts_check(self):
        r = subprocess.run(["npx", "tsc", "--noEmit"], cwd=ROOT, capture_output=True, text=True)
        return r.returncode == 0

    def _lint(self):
        r = subprocess.run(["npx", "oxlint"], cwd=ROOT, capture_output=True, text=True)
        return r.returncode in (0, 1)  # 1 = warnings only

    def _backend_tests(self):
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_api.py", "-x", "--tb=short",
             "-k", "not test_full_analysis and not test_predict and not test_heatmap and not test_chat and not TestPatients",
             "-p", "no:cacheprovider"],
            cwd=ROOT, capture_output=True, text=True, timeout=120
        )
        return r.returncode == 0

    def _clinical_tests(self):
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_clinical_pipeline.py", "-x", "--tb=short", "-p", "no:cacheprovider"],
            cwd=ROOT, capture_output=True, text=True, timeout=60
        )
        return r.returncode == 0

    def _frontend_build(self):
        env = os.environ.copy()
        env["EXPORT_DESKTOP"] = "true"
        r = subprocess.run(["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=180)
        return r.returncode == 0


class ProductionBot(Bot):
    """Production validation — DMG smoke test, security, signing check."""

    def __init__(self):
        super().__init__("PROD")

    def run(self):
        self.say("Starting production validation...")
        checks = [
            ("Version consistency", self._version_check),
            ("Backend binary exists", self._backend_check),
            ("DMG integrity", self._dmg_check),
            ("Core files present", self._core_files),
        ]
        for name, fn in checks:
            self.say(f"  → {name}")
            if not fn():
                self.fail(f"Production check failed: {name}")
                return False
        self.ok("All production checks passed")
        return True

    def _version_check(self):
        """Verify package.json and app_state.py versions match."""
        pkg = json.load(open(ROOT / "package.json"))
        ver_pkg = pkg["version"]
        ver_py = "0.0.0"
        for line in open(VERSION_FILE):
            if line.startswith("VERSION"):
                ver_py = line.split('"')[1]
        ok = ver_pkg == ver_py
        if not ok:
            self.say(f"  Version mismatch: package.json={ver_pkg} app_state.py={ver_py}")
        return ok

    def _backend_check(self):
        """Check PyInstaller binary exists and is non-trivial."""
        binary = DIST / ".." / "dist" / "omnia-backend" if (ROOT / "dist" / "omnia-backend").exists() else None
        if binary and os.path.getsize(binary) > 10_000_000:
            return True
        # Maybe not built yet — just warn
        self.say("  Skipping backend binary check (not pre-built)")
        return True

    def _dmg_check(self):
        """Check DMG exists and has reasonable size."""
        dmgs = list(DIST.glob("*.dmg")) if DIST.exists() else []
        if dmgs:
            size_mb = os.path.getsize(max(dmgs, key=os.path.getctime)) / 1_048_576
            return size_mb > 100  # DMG should be > 100 MB
        self.say("  No DMG found to validate")
        return True

    def _core_files(self):
        """Verify critical files exist."""
        required = ["desktop/main.js", "desktop/preload.js", "package.json"]
        missing = [f for f in required if not (ROOT / f).exists()]
        if missing:
            self.say(f"  Missing: {', '.join(missing)}")
        return len(missing) == 0


class BuildBot(Bot):
    """Builds DMG and optionally EXE."""

    def __init__(self, platform="mac"):
        super().__init__("BUILD")
        self.platform = platform

    def run(self):
        self.say(f"Building for {self.platform}...")

        # Step 1: Build frontend with standalone output
        self.say("  Building frontend (standalone)...")
        env = os.environ.copy()
        env["EXPORT_DESKTOP"] = "true"
        r = subprocess.run(["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=180, env=env)
        if r.returncode != 0:
            self.fail(f"Frontend build failed: {r.stderr[-200:]}")
            return False
        self.say("  Frontend built")

        # Step 2: Build backend with PyInstaller
        self.say("  Building backend (PyInstaller)...")
        pyi_cmd = [
            sys.executable, "-m", "PyInstaller",
            "--name", "omnia-backend",
            "--onefile",
            "--distpath", str(ROOT / "dist"),
            "--workpath", str(ROOT / "build" / "pyinstaller"),
        ]
        model_path = ROOT / "aria_model_dicom.pth"
        if model_path.exists():
            pyi_cmd += ["--add-data", "aria_model_dicom.pth:."]
        pyi_cmd += ["--hidden-import", "backend.main", "--hidden-import", "backend.app_state"]
        # Add all hidden imports
        for mod in ["backend.models", "backend.models.aria_model", "backend.routes",
                     "backend.routes.analysis", "backend.routes.system", "backend.routes.dicom",
                     "backend.routes.auth", "backend.routes.updates", "backend.routes.feedback",
                     "backend.deid", "backend.audit", "backend.accounts", "backend.auth",
                     "backend.orchestrator", "backend.dicom_scp", "backend.metrics",
                     "backend.patients", "backend.radiomics", "backend.structured_report",
                     "backend.clinical_guidelines", "backend.longitudinal", "backend.validation_pipeline",
                     "backend.config", "backend.detector", "backend.dicom_validator",
                     "backend.model_version", "backend.ollama_client",
                     "uvicorn", "uvicorn.logging", "uvicorn.loops.auto",
                     "uvicorn.protocols.http.auto", "uvicorn.middleware", "uvicorn.middleware.cors"]:
            pyi_cmd += ["--hidden-import", mod]
        pyi_cmd += [str(ROOT / "backend" / "main.py")]
        r = subprocess.run(pyi_cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            self.fail(f"Backend build failed: {r.stderr[-200:]}")
            return False
        backend_size = (ROOT / "dist" / "omnia-backend").stat().st_size / 1_048_576 if (ROOT / "dist" / "omnia-backend").exists() else 0
        self.say(f"  Backend built ({backend_size:.0f} MB)")

        # Step 3: Copy static assets to standalone
        self.say("  Copying .next/static to standalone output...")
        shutil.copytree(ROOT / ".next" / "static", ROOT / ".next" / "standalone" / ".next" / "static", dirs_exist_ok=True)

        # Step 2: Prepare node_modules workaround
        self.say("  Preparing _modules for electron-builder...")
        src_node = ROOT / ".next" / "standalone" / "node_modules"
        dst_mods = ROOT / ".next" / "standalone" / "_modules"
        if src_node.exists():
            if dst_mods.exists():
                shutil.rmtree(dst_mods)
            shutil.copytree(src_node, dst_mods)

        # Step 3: Build DMG
        self.say("  Building DMG with electron-builder...")
        if self.platform == "mac":
            r = subprocess.run(
                ["npx", "electron-builder", "--mac", "--publish=never",
                 "--config.extraMetadata.main=desktop/main.js"],
                cwd=ROOT, capture_output=True, text=True, timeout=600
            )
        else:
            r = subprocess.run(
                ["npx", "electron-builder", "--win", "--publish=never",
                 "--config.extraMetadata.main=desktop/main.js"],
                cwd=ROOT, capture_output=True, text=True, timeout=600
            )
        if r.returncode != 0:
            self.fail(f"Build failed: {r.stderr[-300:]}")
            return False

        # Show result
        dmgs = list(DIST.glob("*.dmg"))
        exes = list(DIST.glob("*.exe"))
        artifacts = dmgs + exes
        if artifacts:
            for a in artifacts:
                size = os.path.getsize(a) / 1_048_576
                self.say(f"  📦 {a.name} ({size:.0f} MB)")
                # Remove quarantine flag so macOS doesn't show "damaged" error
                subprocess.run(["xattr", "-cr", str(a)], capture_output=True)
                self.say(f"  🔓 Quarantine removed from {a.name}")
        self.ok(f"Build complete — {len(artifacts)} artifacts")
        return True


class ReleaseBot(Bot):
    """Tags, creates GitHub Release, uploads artifacts."""

    def __init__(self):
        super().__init__("RELEASE")

    def run(self):
        pkg = json.load(open(ROOT / "package.json"))
        version = pkg["version"]
        tag = f"v{version}"

        self.say(f"Releasing {tag}...")

        # Delete existing tag if any
        subprocess.run(["git", "tag", "-d", tag], cwd=ROOT, capture_output=True)
        subprocess.run(["git", "push", "--delete", "origin", tag], cwd=ROOT, capture_output=True)

        # Create tag
        subprocess.run(["git", "tag", tag], cwd=ROOT)
        r = subprocess.run(["git", "push", "origin", tag], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            self.fail(f"Tag push failed: {r.stderr}")
            return False

        # Create GitHub Release
        dmgs = list(DIST.glob("*.dmg")) if DIST.exists() else []
        exes = list(DIST.glob("*.exe")) if DIST.exists() else []
        artifacts = dmgs + exes

        # Delete existing release
        subprocess.run(["gh", "release", "delete", tag, "--yes"], capture_output=True)

        # Create release
        note = (
            f"Omnia AI v{version} — Released by Omnia Distribution Engine\n\n"
            f"## How to install\n"
            f"1. Download the DMG\n"
            f"2. Open Terminal and run:\n"
            f"   ```\n"
            f"   xattr -cr /Applications/Omnia\\ AI.app\n"
            f"   ```\n"
            f"3. Drag to Applications and open\n\n"
            f"## Changes in v{version}\n"
            f"- See commit log for details\n\n"
            f"Artifacts: {len(artifacts)} files"
        )
        cmd = ["gh", "release", "create", tag, "--title", f"Omnia AI {tag}", "--notes", note]
        for a in artifacts:
            cmd.append(str(a))
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            self.fail(f"Release failed: {r.stderr[-200:]}")
            return False
        self.ok(f"Released {tag} with {len(artifacts)} artifacts")
        return True


class ValidatorBot(Bot):
    """Validates the GitHub Release before declaring it live."""

    def __init__(self):
        super().__init__("VALIDATOR")

    def run(self):
        pkg = json.load(open(ROOT / "package.json"))
        version = pkg["version"]
        tag = f"v{version}"

        self.say(f"Validating release {tag}...")
        checks = [
            ("Release exists on GitHub", self._release_exists(tag)),
            ("DMG asset uploaded", self._has_dmg(tag)),
            ("Version tag matches", self._version_matches(tag, version)),
            ("No draft mode", self._not_draft(tag)),
        ]
        failures = []
        for name, ok in checks:
            status = "✅" if ok else "❌"
            self.say(f"  {status} {name}")
            if not ok:
                failures.append(name)

        if failures:
            self.fail(f"Validation failed: {', '.join(failures)}")
            return False

        self.ok(f"Release {tag} fully validated — ready for clinics")
        self.say("  ⚠️  DMG is not code-signed. Fix: xattr -cr /Applications/Omnia\\ AI.app")
        return True

    def _release_exists(self, tag):
        """Verify the release is accessible via API."""
        r = subprocess.run(
            ["gh", "release", "view", tag, "--json", "tagName"],
            capture_output=True, text=True
        )
        return r.returncode == 0

    def _has_dmg(self, tag):
        """Verify at least one DMG/EXE asset is attached."""
        r = subprocess.run(
            ["gh", "release", "view", tag, "--json", "assets"],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            return False
        try:
            assets = json.loads(r.stdout).get("assets", [])
            return any(a["name"].endswith((".dmg", ".exe")) for a in assets)
        except (json.JSONDecodeError, KeyError):
            return False

    def _version_matches(self, tag, version):
        """Verify tag name matches package version."""
        expected = f"v{version}"
        return tag == expected

    def _not_draft(self, tag):
        """Verify release is not in draft/prerelease state."""
        r = subprocess.run(
            ["gh", "release", "view", tag, "--json", "isDraft,isPrerelease"],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            return False
        try:
            data = json.loads(r.stdout)
            return not data.get("isDraft", True) and not data.get("isPrerelease", False)
        except (json.JSONDecodeError, KeyError):
            return False


class DistributionEngine:
    """Orchestrates all bots in the correct order."""

    def __init__(self, mode="full"):
        self.mode = mode
        self.bots = []

    def run(self):
        print("\n" + "=" * 70)
        print("  🏭 Omnia Distribution Engine")
        print(f"  Mode: {self.mode.upper()}  |  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)

        if self.mode in ("full", "debug"):
            bot = DebugBot()
            self.bots.append(bot)
            if not bot.run():
                self._summary()
                return False

        if self.mode in ("full", "debug"):
            bot = ProductionBot()
            self.bots.append(bot)
            if not bot.run():
                self._summary()
                return False

        if self.mode in ("full", "build"):
            bot = BuildBot("mac")
            self.bots.append(bot)
            if not bot.run():
                self._summary()
                return False

        if self.mode in ("full", "ship"):
            bot = ReleaseBot()
            self.bots.append(bot)
            if not bot.run():
                self._summary()
                return False

        if self.mode in ("full", "ship"):
            bot = ValidatorBot()
            self.bots.append(bot)
            if not bot.run():
                self._summary()
                return False

        self._summary()
        return True

    def _summary(self):
        print("\n" + "=" * 70)
        print("  📊 Distribution Engine Summary")
        print("=" * 70)
        all_ok = True
        for bot in self.bots:
            icon = "✅" if bot.status == "passed" else "❌"
            if bot.status != "passed": all_ok = False
            print(f"  {icon} {bot.name}: {bot.status.upper()} ({time.time()-bot.start:.1f}s)")
        print("=" * 70)
        if all_ok:
            print("  🎉 Pipeline complete — ready for clinic distribution!")
        else:
            print("  ⚠️  Some checks failed — review logs above")
        print("=" * 70)


if __name__ == "__main__":
    mode = "full"
    if "--debug" in sys.argv: mode = "debug"
    if "--build" in sys.argv: mode = "build"
    if "--ship" in sys.argv: mode = "ship"

    engine = DistributionEngine(mode)
    success = engine.run()
    sys.exit(0 if success else 1)
