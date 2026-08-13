#!/usr/bin/env python3
"""
Omnia AI — Diagnostics Collector
==================================
Collects server state into a timestamped .zip for debugging.
Clinic staff can run this and email the zip to the developer.
No patient data is included — only system diagnostics.

Usage:
    python3 scripts/collect_diagnostics.py
    → outputs: omnia_diagnostics_2026-07-06_125000.zip
"""

import json
import zipfile
import argparse
from datetime import datetime
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
BACKUP_DIR = PROJECT_ROOT / "backups"
LOG_DIR = PROJECT_ROOT / "logs"
AUDIT_LOG = PROJECT_ROOT / "audit_log.jsonl"

# ── Collectors ───────────────────────────────────────────────────────────

def collect_system_info() -> dict:
    """Basic system info (no PII)."""
    import platform
    import shutil

    total, used, free = shutil.disk_usage(str(PROJECT_ROOT))
    return {
        "timestamp": datetime.now().isoformat(),
        "project_root": str(PROJECT_ROOT),
        "os": f"{platform.system()} {platform.release()}",
        "python": platform.python_version(),
        "disk_total_gb": round(total / (1024**3), 1),
        "disk_free_gb": round(free / (1024**3), 1),
        "disk_used_pct": round(used / total * 100, 1),
    }


def collect_db_stats() -> dict:
    """SQLite database file sizes and row counts."""
    stats = {}
    for db_file in DATA_DIR.glob("*.db"):
        try:
            import sqlite3
            conn = sqlite3.connect(str(db_file))
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = {}
            for (name,) in cursor.fetchall():
                (count,) = conn.execute(f"SELECT COUNT(*) FROM [{name}]").fetchone()
                tables[name] = count
            conn.close()
            stats[db_file.name] = {
                "size_kb": round(db_file.stat().st_size / 1024, 1),
                "tables": tables,
            }
        except Exception as e:
            stats[db_file.name] = {"error": str(e)}
    return stats


def collect_backup_info() -> dict:
    """List recent backups."""
    backups = []
    for f in sorted(BACKUP_DIR.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
        backups.append({
            "name": f.name,
            "size_kb": round(f.stat().st_size / 1024, 1),
            "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        })
    return {"backup_dir": str(BACKUP_DIR), "count": len(backups), "recent": backups}


def collect_audit_summary() -> dict:
    """Last 50 audit entries (already de-identified by backend)."""
    entries = []
    if AUDIT_LOG.is_file():
        for line in list(open(AUDIT_LOG, "r"))[-50:]:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    entries.append({"raw": line[:500]})
    error_count = sum(1 for e in entries if e.get("severity") == "error" or e.get("action") == "error")
    return {
        "total_entries": len(entries),
        "recent_errors": error_count,
        "sample": entries[-10:] if entries else [],
    }


def collect_server_logs() -> dict:
    """Last 100 lines from any server log files."""
    logs = {}
    for log_file in sorted(LOG_DIR.glob("*.log*"))[-5:]:
        lines = log_file.read_text().splitlines()
        logs[log_file.name] = lines[-100:]
    # Also check stdout/stderr captures
    for f in PROJECT_ROOT.glob("*.log"):
        lines = f.read_text().splitlines()
        logs[f.name] = lines[-100:]
    return logs


def collect_error_summary() -> dict:
    """Count errors by type from audit log."""
    error_types = {}
    if AUDIT_LOG.is_file():
        for line in open(AUDIT_LOG, "r"):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("severity") == "error":
                    details = entry.get("details", {})
                    if isinstance(details, dict):
                        err_type = details.get("error", "unknown")[:100]
                    elif isinstance(details, str):
                        err_type = details[:100]
                    else:
                        err_type = "unknown"
                    error_types[err_type] = error_types.get(err_type, 0) + 1
            except json.JSONDecodeError:
                pass
    return error_types


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Collect Omnia AI diagnostics")
    parser.add_argument("-o", "--output", help="Output path (default: omnia_diagnostics_<timestamp>.zip)")
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    output_path = args.output or f"omnia_diagnostics_{timestamp}.zip"

    print("Collecting diagnostics...")

    data = {
        "system": collect_system_info(),
        "database": collect_db_stats(),
        "backups": collect_backup_info(),
        "audit": collect_audit_summary(),
        "errors": collect_error_summary(),
        "server_logs": collect_server_logs(),
    }

    # Write ZIP
    zip_path = Path(output_path)
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("diagnostics.json", json.dumps(data, indent=2, default=str))
        # Attach last 200 lines of audit log
        if AUDIT_LOG.is_file():
            tail = "".join(list(open(AUDIT_LOG, "r"))[-200:])
            zf.writestr("audit_log_tail.jsonl", tail)

    print(f"Diagnostics saved to: {zip_path.resolve()}")
    print(f"  Size: {round(zip_path.stat().st_size / 1024, 1)} KB")
    print("  Contains: system info, DB stats, audit summary, error counts, server logs")
    print("  No patient data included.")


if __name__ == "__main__":
    main()
