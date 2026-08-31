"""Versioned storage for the federated network.

Two areas:
    pending/    contributions received from sites, not yet merged into
                anything. Nothing here is automatic — a human runs the merge.
    releases/   published global head versions, numbered and signed, that
                sites can pull.

Local disk is deliberately enough for now. This is a manual-aggregation
pilot with a handful of sites, not a multi-region service; move to object
storage only when the number of sites or the release cadence makes local
disk the actual bottleneck.
"""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING_DIR = ROOT / "pending"
RELEASES_DIR = ROOT / "releases"
SITES_FILE = ROOT / "sites.json"

PENDING_DIR.mkdir(parents=True, exist_ok=True)
RELEASES_DIR.mkdir(parents=True, exist_ok=True)


def save_contribution(site_id: str, weights_bytes: bytes, metadata: dict) -> str:
    """Store one site's head-delta upload. Returns the contribution id."""
    stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S%f")
    contribution_id = f"{site_id}_{stamp}"
    site_dir = PENDING_DIR / contribution_id
    site_dir.mkdir(parents=True, exist_ok=False)

    (site_dir / "head.pt").write_bytes(weights_bytes)
    (site_dir / "meta.json").write_text(json.dumps({
        **metadata,
        "site_id": site_id,
        "received_at": datetime.datetime.now().isoformat(),
        "size_bytes": len(weights_bytes),
    }, indent=2))

    return contribution_id


def _record_dirs(root: Path) -> list[Path]:
    """Subdirectories of `root` that actually hold a record.

    Filtering on is_dir() is not incidental tidiness: these directories also
    contain non-record entries — a .gitkeep placeholder so the empty dir
    survives git, and potentially editor or OS droppings like .DS_Store.
    Treating one of those as a release made `latest_release()` raise
    NotADirectoryError on exactly the state a freshly deployed server is in,
    which is the state every site's first `GET /latest` poll would hit.
    """
    return sorted((d for d in root.iterdir() if d.is_dir()), key=lambda d: d.name)


def list_pending() -> list[dict]:
    out = []
    for d in _record_dirs(PENDING_DIR):
        meta_file = d / "meta.json"
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
            meta["contribution_id"] = d.name
            out.append(meta)
    return out


def latest_release() -> dict | None:
    releases = [d for d in _record_dirs(RELEASES_DIR) if (d / "meta.json").exists()]
    if not releases:
        return None
    latest = releases[-1]
    meta = json.loads((latest / "meta.json").read_text())
    meta["version"] = latest.name
    return meta


def list_releases() -> list[dict]:
    out = []
    for d in reversed(_record_dirs(RELEASES_DIR)):
        meta_file = d / "meta.json"
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
            meta["version"] = d.name
            out.append(meta)
    return out


def get_release(version: str) -> tuple[bytes, dict] | None:
    d = RELEASES_DIR / version
    if not d.exists():
        return None
    weights = (d / "head.pt").read_bytes()
    meta = json.loads((d / "meta.json").read_text())
    return weights, meta


def remove_pending(contribution_ids: list[str]) -> None:
    """Remove contributions from pending/ after they've been folded into a
    release, so the same upload can't be merged twice."""
    import shutil
    for cid in contribution_ids:
        d = PENDING_DIR / cid
        if d.exists():
            shutil.rmtree(d)


# ─── Sites ───
# A "site" here is a bookkeeping record, not what actually gates access — the
# HMAC-signed key (auth.py) is what's verified on every request. This is just
# so the admin dashboard has something to list: who a key was issued to and
# when, plus contribution stats derived from what's actually on disk rather
# than a counter that could drift from reality.

def register_site(site_id: str, site_name: str) -> dict:
    sites = _read_sites()
    if any(s["site_id"] == site_id for s in sites):
        raise ValueError(f"Site id '{site_id}' is already registered.")
    record = {
        "site_id": site_id,
        "site_name": site_name,
        "issued_at": datetime.datetime.now().isoformat(),
    }
    sites.append(record)
    SITES_FILE.write_text(json.dumps(sites, indent=2))
    return record


def list_sites() -> list[dict]:
    """Registered sites, each annotated with contribution stats computed
    live from pending/ and releases/ — counted from the source of truth
    rather than a separately maintained tally that could go stale."""
    sites = _read_sites()

    counts: dict[str, int] = {}
    last_seen: dict[str, str] = {}

    for c in list_pending():
        sid = c["site_id"]
        counts[sid] = counts.get(sid, 0) + 1
        if sid not in last_seen or c["received_at"] > last_seen[sid]:
            last_seen[sid] = c["received_at"]

    for r in list_releases():
        for c in r.get("contributions", []):
            sid = c["site_id"] if isinstance(c, dict) else c
            counts[sid] = counts.get(sid, 0) + 1
            published = r.get("published_at", "")
            if sid not in last_seen or published > last_seen[sid]:
                last_seen[sid] = published

    for s in sites:
        sid = s["site_id"]
        s["contribution_count"] = counts.get(sid, 0)
        s["last_contribution_at"] = last_seen.get(sid)

    return sites


def _read_sites() -> list[dict]:
    if not SITES_FILE.exists():
        return []
    return json.loads(SITES_FILE.read_text())
