"""Federated merge — sample-weighted FedAvg over a set of contributions.

Nothing here runs on a schedule or on upload. `publish_merge()` is the
shared core, called either from this CLI or from the admin dashboard's
POST /admin/merge — both paths require an explicit list of contribution
ids, so a merge always reflects a deliberate choice of which contributions
go in, not "everything that happened to be pending."

This does not include the eval-gate itself (comparing merged QWK against the
currently published version on a held-out benchmark) — that reuses the same
promotion logic as backend/finetune.py and needs your benchmark tensor path
wired in before this goes live for a real release a site will adopt.
"""
import argparse
import datetime
import hashlib
import hmac
import json
import os
import shutil
import tempfile
import threading
from pathlib import Path

from . import auth, storage

# Serialises publish_merge across the CLI and the /admin/merge route.
#
# Two merges running at once is not hypothetical: the console lets an operator
# click Merge twice, and the CLI can be run while the server is up. Without
# this, both read the same pending list, average the same contributions into
# two different releases, and each then removes the pending directories the
# other is still reading — so one merge fails partway and the queue is emptied
# for a release that was never published.
_MERGE_LOCK = threading.Lock()


def _fedavg(contributions: list[dict]) -> dict:
    import torch

    total_samples = sum(c["sample_count"] for c in contributions)
    if total_samples == 0:
        raise ValueError("No samples across the selected contributions.")

    merged = None
    for c in contributions:
        state = torch.load(storage.PENDING_DIR / c["contribution_id"] / "head.pt",
                            map_location="cpu", weights_only=True)
        weight = c["sample_count"] / total_samples
        if merged is None:
            merged = {k: v.clone().float() * weight for k, v in state.items()}
        else:
            for k, v in state.items():
                merged[k] += v.float() * weight
    return merged


def _sign_release(weights_bytes: bytes) -> str:
    return hmac.new(auth.SECRET, weights_bytes, hashlib.sha256).hexdigest()


def publish_merge(contribution_ids: list[str]) -> dict:
    """Merge exactly the given pending contributions and publish the result
    as a new release. Raises ValueError if any id isn't actually pending."""
    import torch

    with _MERGE_LOCK:
        pending_by_id = {c["contribution_id"]: c for c in storage.list_pending()}
        missing = [cid for cid in contribution_ids if cid not in pending_by_id]
        if missing:
            raise ValueError(f"Not in pending: {', '.join(missing)}")
        if not contribution_ids:
            raise ValueError("No contributions selected.")

        selected = [pending_by_id[cid] for cid in contribution_ids]
        merged_state = _fedavg(selected)

        # A per-call temp file, not a fixed name in ROOT: a shared name is a
        # collision between concurrent merges, and a crash between save and
        # move leaves a stray file that looks like a half-written release.
        fd, tmp_name = tempfile.mkstemp(dir=str(storage.ROOT), prefix="_merge_", suffix=".pt")
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            torch.save(merged_state, tmp_path)
            weights_bytes = tmp_path.read_bytes()

            # Second-granularity timestamps collide if two merges land in the
            # same second; claim the directory with exist_ok=False and step
            # the version rather than silently publishing into another
            # release's directory.
            base = datetime.datetime.now().strftime("v%Y%m%dT%H%M%S")
            version, suffix = base, 0
            while True:
                release_dir = storage.RELEASES_DIR / version
                try:
                    release_dir.mkdir(parents=True, exist_ok=False)
                    break
                except FileExistsError:
                    suffix += 1
                    version = f"{base}-{suffix}"

            shutil.move(str(tmp_path), release_dir / "head.pt")
        finally:
            tmp_path.unlink(missing_ok=True)

        signature = _sign_release(weights_bytes)
        meta = {
            "version": version,
            "signature": signature,
            "contributions": [
                {"contribution_id": c["contribution_id"], "site_id": c["site_id"]}
                for c in selected
            ],
            "total_samples": sum(c["sample_count"] for c in selected),
            "published_at": datetime.datetime.now().isoformat(),
        }
        # Written last, and it is what every reader uses to recognise a release
        # (see storage._record_dirs) — so a crash mid-publish leaves a
        # directory that is ignored rather than served as a valid release.
        (release_dir / "meta.json").write_text(json.dumps(meta, indent=2))

        storage.remove_pending(contribution_ids)

        return meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="publish without an interactive confirm")
    args = parser.parse_args()

    pending = storage.list_pending()
    if not pending:
        print("No pending contributions.")
        return

    print(f"{len(pending)} pending contribution(s):")
    for c in pending:
        print(f"  {c['contribution_id']}  site={c['site_id']}  "
              f"samples={c['sample_count']}  local_val_qwk={c['local_val_qwk']:.4f}")

    total_samples = sum(c["sample_count"] for c in pending)
    print(f"\nWould merge {total_samples} total samples across {len(pending)} contribution(s).")
    print("NOTE: run this against your held-out benchmark before publishing — "
          "this script does not evaluate agreement for you yet.")

    if not args.yes:
        resp = input("\nPublish a merge of ALL pending contributions as a new release? [y/N] ")
        if resp.strip().lower() != "y":
            print("Not published. Contributions remain in pending/.")
            return

    meta = publish_merge([c["contribution_id"] for c in pending])
    print(f"\nPublished {meta['version']}. Sites will see it on their next GET /latest.")


if __name__ == "__main__":
    main()
