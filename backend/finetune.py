"""Omnia AI — real fine-tuning of the grading model on site-reviewed slides.

What this actually does
-----------------------
Every slide a pathologist has signed carries a ground-truth ISUP grade group.
This module trains the model's *attention and classifier heads* on those
labels, keeping the EfficientNet-B0 backbone frozen.

Why the backbone is frozen — this is a real constraint, not a shortcut. A site
that has reviewed a few dozen slides has a few dozen labels. The backbone has
roughly four million parameters; fitting it to that many examples memorises
them and produces a model that scores well on its own training data and worse
on everything else. The heads are a few hundred thousand parameters over
pre-computed features, which is trainable at this data scale and on the CPU a
clinic actually has.

The safeguard that matters
--------------------------
A fine-tune is trained on one part of the reviewed slides and measured on a
held-out part it never saw. It replaces the active model only if it agrees
with the pathologist *better* than the current model does on that same
held-out set. A run that makes grading worse is kept as a record and
discarded as a model — silently promoting a degraded model is the failure
that would matter clinically.

Agreement is measured with quadratic weighted kappa (QWK), the standard metric
for ordinal grading: it treats predicting grade 2 for a grade 5 slide as a far
worse error than predicting grade 4, which plain accuracy does not.
"""
import datetime
import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Callable, Optional

import numpy as np

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
FEATURE_CACHE = DATA_DIR / "feature_cache"
MODEL_DIR = DATA_DIR / "models"
ACTIVE_POINTER = MODEL_DIR / "active.json"

# Below this, a held-out split is too small to say anything about whether the
# fine-tune helped, so there is nothing to gate promotion on.
MIN_EXAMPLES = 20
# Fraction held out for validation. With small datasets a larger share buys
# a more trustworthy comparison, which is the whole point of the gate.
VAL_FRACTION = 0.3
N_CLASSES = 6


class FineTuneError(RuntimeError):
    """Raised when a fine-tune cannot be run or its result cannot be used."""


# ─── Agreement metric ───

def quadratic_weighted_kappa(actual, predicted, n_classes: int = N_CLASSES) -> float:
    """QWK between two integer grade sequences.

    Returns 0.0 when the metric is undefined (a single class present in both),
    because a run with no grade variation carries no evidence either way.
    """
    actual = np.asarray(actual, dtype=int)
    predicted = np.asarray(predicted, dtype=int)
    if actual.size == 0:
        return 0.0

    observed = np.zeros((n_classes, n_classes), dtype=float)
    for a, p in zip(actual, predicted):
        observed[a, p] += 1

    hist_a = np.bincount(actual, minlength=n_classes).astype(float)
    hist_p = np.bincount(predicted, minlength=n_classes).astype(float)
    expected = np.outer(hist_a, hist_p) / max(actual.size, 1)

    idx = np.arange(n_classes)
    weights = (idx[:, None] - idx[None, :]) ** 2 / (n_classes - 1) ** 2

    denom = float((weights * expected).sum())
    if denom == 0:
        return 0.0
    return float(1.0 - (weights * observed).sum() / denom)


# ─── Feature extraction ───

def _cache_key(filepath: str) -> str:
    """Key on path plus size and mtime, so a replaced file is re-extracted."""
    try:
        st = os.stat(filepath)
        stamp = f"{filepath}:{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        stamp = filepath
    return hashlib.sha256(stamp.encode()).hexdigest()[:32]


def extract_features(filepath: str, force: bool = False) -> np.ndarray:
    """Per-tile embeddings for one slide, shape (N_TILES, 1280).

    Cached on disk: extraction is the expensive step, and it produces the same
    result every run because the tile sampling is seeded by file path.
    """
    import torch
    from backend import grading_model as gm

    FEATURE_CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = FEATURE_CACHE / f"{_cache_key(filepath)}.npy"
    if cache_file.exists() and not force:
        try:
            return np.load(cache_file)
        except (ValueError, OSError):
            pass  # corrupt cache entry — fall through and rebuild it

    model, device, norm = gm._get_model()
    tiles, _coords, _dims = gm._load_tile_bag(filepath)

    t = torch.from_numpy(tiles).permute(0, 3, 1, 2).float() / 255.0
    t = norm(t).to(device)
    with torch.no_grad():
        feats = model.pool(model.features(t)).flatten(1)
    out = feats.cpu().numpy().astype(np.float32)

    tmp = cache_file.with_suffix(".npy.part")
    np.save(tmp, out)
    tmp.replace(cache_file)
    return out


# ─── Head-only model ───

def _build_heads(base_state: Optional[dict] = None):
    """Attention + regression + classification heads, initialised from the
    active checkpoint so a fine-tune starts where the shipped model left off
    rather than from scratch."""
    import torch.nn as nn
    from backend.grading_model import AttentionMIL

    full = AttentionMIL()
    if base_state:
        full.load_state_dict(base_state)

    class Heads(nn.Module):
        """Operates on pre-computed tile features, so the frozen backbone is
        never re-run during training."""

        def __init__(self, src: AttentionMIL):
            super().__init__()
            self.attn_V = src.attn_V
            self.attn_U = src.attn_U
            self.attn_w = src.attn_w
            self.reg_head = src.reg_head
            self.cls_head = src.cls_head

        def forward(self, feat):  # feat: (B, N, 1280)
            import torch
            a = self.attn_w(self.attn_V(feat) * self.attn_U(feat)).squeeze(-1)
            weights = torch.softmax(a, dim=1)
            embedding = torch.bmm(weights.unsqueeze(1), feat).squeeze(1)
            return self.reg_head(embedding).squeeze(-1), self.cls_head(embedding)

    return Heads(full), full


def _predict_groups(heads, features, thresholds) -> np.ndarray:
    """Grade groups from the heads, combining both heads exactly as inference
    does — otherwise validation would measure something the app never runs."""
    import torch
    import torch.nn.functional as F

    heads.eval()
    with torch.no_grad():
        reg_out, cls_out = heads(features)
        cls_prob = F.softmax(cls_out, dim=1)
        cls_expected = (cls_prob * torch.arange(N_CLASSES).float()).sum(1)
        score = 0.5 * reg_out.float() + 0.5 * cls_expected.float()
    scores = score.cpu().numpy()
    return np.clip(np.searchsorted(thresholds, scores), 0, N_CLASSES - 1)


# ─── Training ───

def run_finetune(
    examples: list,
    epochs: int = 12,
    lr: float = 3e-4,
    seed: int = 1337,
    progress: Optional[Callable[[dict], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> dict:
    """Fine-tune the heads on `examples`.

    Each example is {"filepath": str, "grade_group": int}. Returns a summary
    including whether the result was good enough to promote.
    """
    import torch
    import torch.nn as nn
    from backend import grading_model as gm

    def emit(**fields):
        if progress:
            progress(fields)

    def cancelled() -> bool:
        return bool(should_cancel and should_cancel())

    if len(examples) < MIN_EXAMPLES:
        raise FineTuneError(
            f"{len(examples)} reviewed slides available; at least {MIN_EXAMPLES} are "
            "needed before a fine-tune can be measured honestly."
        )

    torch.manual_seed(seed)
    rng = np.random.RandomState(seed)

    # ── Feature extraction ──
    emit(stage="extracting", message="Reading slides and extracting features…", progress=0.0)
    feats, labels, used = [], [], []
    for i, ex in enumerate(examples):
        if cancelled():
            raise FineTuneError("Cancelled")
        try:
            feats.append(extract_features(ex["filepath"]))
            labels.append(int(ex["grade_group"]))
            used.append(ex)
        except Exception as e:  # a single unreadable slide must not sink the run
            emit(message=f"Skipped {Path(ex['filepath']).name}: {e}")
            continue
        emit(
            stage="extracting",
            progress=round(0.35 * (i + 1) / len(examples), 4),
            message=f"Prepared {len(feats)} of {len(examples)} slides",
        )

    if len(feats) < MIN_EXAMPLES:
        raise FineTuneError(
            f"Only {len(feats)} slides could be read; at least {MIN_EXAMPLES} are needed."
        )

    X = torch.from_numpy(np.stack(feats)).float()   # (M, N_TILES, 1280)
    y = torch.tensor(labels, dtype=torch.long)

    # ── Split ──
    # Stratify so both halves contain the same grade mix where possible; a
    # random split on a small, skewed set can put every high-grade slide on
    # one side and make the comparison meaningless.
    order = _stratified_split(labels, VAL_FRACTION, rng)
    train_idx, val_idx = order
    if len(val_idx) == 0 or len(train_idx) == 0:
        raise FineTuneError("Not enough variety in the reviewed slides to hold out a fair test set.")

    Xtr, ytr = X[train_idx], y[train_idx]
    Xva, yva = X[val_idx], y[val_idx]

    # ── Baseline: how the CURRENT model scores on this same held-out set ──
    base_state = _load_active_state()
    baseline_heads, _ = _build_heads(base_state)
    thresholds = np.array(gm.GRADE_THRESHOLDS)
    base_pred = _predict_groups(baseline_heads, Xva, thresholds)
    base_qwk = quadratic_weighted_kappa(yva.numpy(), base_pred)
    emit(
        stage="baseline",
        progress=0.4,
        message=f"Current model agreement on held-out slides: QWK {base_qwk:.4f}",
        baseline_qwk=round(base_qwk, 4),
    )

    # ── Train ──
    heads, _full = _build_heads(base_state)
    for p in heads.parameters():
        p.requires_grad = True
    opt = torch.optim.AdamW(heads.parameters(), lr=lr, weight_decay=1e-4)
    reg_loss = nn.SmoothL1Loss()
    cls_loss = nn.CrossEntropyLoss()

    history = []
    best = {"qwk": -2.0, "state": None, "epoch": 0}
    for epoch in range(1, epochs + 1):
        if cancelled():
            raise FineTuneError("Cancelled")
        heads.train()
        perm = torch.randperm(len(Xtr))
        batch = max(2, min(8, len(Xtr) // 4 or 2))
        epoch_loss = 0.0
        batches = 0
        for start in range(0, len(perm), batch):
            sel = perm[start:start + batch]
            opt.zero_grad()
            reg_out, cls_out = heads(Xtr[sel])
            loss = reg_loss(reg_out, ytr[sel].float()) + cls_loss(cls_out, ytr[sel])
            loss.backward()
            opt.step()
            epoch_loss += float(loss.item())
            batches += 1

        val_pred = _predict_groups(heads, Xva, thresholds)
        val_qwk = quadratic_weighted_kappa(yva.numpy(), val_pred)
        mean_loss = epoch_loss / max(batches, 1)
        history.append({"epoch": epoch, "loss": round(mean_loss, 4), "qwk": round(val_qwk, 4)})

        # Keep the best epoch by held-out agreement, not the last one — later
        # epochs on a small set usually overfit.
        if val_qwk > best["qwk"]:
            best = {
                "qwk": val_qwk,
                "state": {k: v.detach().clone() for k, v in heads.state_dict().items()},
                "epoch": epoch,
            }

        emit(
            stage="training",
            epoch=epoch,
            progress=round(0.4 + 0.55 * epoch / epochs, 4),
            loss=round(mean_loss, 4),
            qwk=round(val_qwk, 4),
            message=f"Epoch {epoch} of {epochs} — agreement {val_qwk:.4f}",
            history=list(history),
        )

    improved = best["qwk"] > base_qwk
    summary = {
        "examples_used": len(feats),
        "train_size": len(train_idx),
        "val_size": len(val_idx),
        "baseline_qwk": round(base_qwk, 4),
        "finetuned_qwk": round(best["qwk"], 4),
        "best_epoch": best["epoch"],
        "improved": bool(improved),
        "history": history,
        "epochs": epochs,
    }

    if improved and best["state"] is not None:
        path = _save_finetuned(best["state"], base_state, summary)
        summary["checkpoint"] = str(path)
        summary["promoted"] = True
        emit(stage="promoting", progress=1.0,
             message=f"Agreement improved {base_qwk:.4f} → {best['qwk']:.4f}. New model is now active.")
    else:
        summary["promoted"] = False
        emit(stage="rejected", progress=1.0,
             message=(f"Agreement did not improve ({base_qwk:.4f} → {best['qwk']:.4f}). "
                      "The existing model has been kept."))

    return summary


def _stratified_split(labels, val_fraction, rng):
    """Indices split so each grade appears on both sides where it can."""
    labels = np.asarray(labels)
    train_idx, val_idx = [], []
    for grade in np.unique(labels):
        idx = np.where(labels == grade)[0]
        rng.shuffle(idx)
        # A grade seen only once cannot be in both halves; keep it for
        # training, where it at least contributes signal.
        n_val = int(round(len(idx) * val_fraction))
        if len(idx) > 1:
            n_val = max(1, min(n_val, len(idx) - 1))
        else:
            n_val = 0
        val_idx.extend(idx[:n_val].tolist())
        train_idx.extend(idx[n_val:].tolist())
    return np.array(train_idx, dtype=int), np.array(val_idx, dtype=int)


# ─── Checkpoint management ───

def _load_active_state() -> Optional[dict]:
    """State dict of whichever model is currently active."""
    import torch
    from backend import grading_model as gm

    path = active_model_path()
    if path and Path(path).exists():
        state = torch.load(path, map_location="cpu", weights_only=False)
        return state.get("model", state)
    if gm.MODEL_PATH.exists():
        state = torch.load(gm.MODEL_PATH, map_location="cpu", weights_only=False)
        return state.get("model", state)
    return None


def _save_finetuned(head_state: dict, base_state: Optional[dict], summary: dict) -> Path:
    """Write a complete checkpoint: the frozen backbone plus the new heads.

    A head-only file would not be loadable by the inference path, which
    expects a full state dict.
    """
    import torch

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    merged = dict(base_state or {})
    merged.update(head_state)

    stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    path = MODEL_DIR / f"omnia_prostate_finetuned_{stamp}.pt"
    tmp = path.with_suffix(".pt.part")
    torch.save({"model": merged, "finetune": summary,
                "created": datetime.datetime.now().isoformat()}, tmp)
    tmp.replace(path)

    _write_active(path, summary)

    # Make the promoted model take effect immediately. Otherwise the run
    # reports success while inference continues on the previous weights.
    try:
        from backend import grading_model as gm
        gm.reload_model()
    except Exception as e:  # promotion already succeeded; a stale cache is recoverable
        import logging
        logging.getLogger(__name__).warning("Promoted model but could not refresh cache: %s", e)

    return path


def _write_active(path: Path, summary: dict):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp = ACTIVE_POINTER.with_suffix(".json.part")
    tmp.write_text(json.dumps({
        "path": str(path),
        "qwk": summary.get("finetuned_qwk"),
        "baseline_qwk": summary.get("baseline_qwk"),
        "examples_used": summary.get("examples_used"),
        "activated": datetime.datetime.now().isoformat(),
    }, indent=2))
    tmp.replace(ACTIVE_POINTER)


def active_model_path() -> Optional[str]:
    """Path of the active fine-tuned checkpoint, or None for the shipped model."""
    try:
        info = json.loads(ACTIVE_POINTER.read_text())
    except (OSError, ValueError):
        return None
    path = info.get("path")
    return path if path and Path(path).exists() else None


def active_model_info() -> dict:
    """What the app is currently grading with, in terms a reader can check."""
    path = active_model_path()
    if not path:
        return {"source": "shipped", "path": None,
                "description": "The model supplied with Omnia, trained on a public prostate "
                               "biopsy dataset. No slides from this site have changed it."}
    try:
        info = json.loads(ACTIVE_POINTER.read_text())
    except (OSError, ValueError):
        info = {}
    return {
        "source": "finetuned",
        "path": path,
        "qwk": info.get("qwk"),
        "baseline_qwk": info.get("baseline_qwk"),
        "examples_used": info.get("examples_used"),
        "activated": info.get("activated"),
        "description": "Adapted to this site using slides your pathologists have signed.",
    }


def revert_to_shipped() -> bool:
    """Go back to the model supplied with the app. The fine-tuned checkpoints
    are left on disk so the change is reversible."""
    if not ACTIVE_POINTER.exists():
        return False
    ACTIVE_POINTER.unlink()
    return True
