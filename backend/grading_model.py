"""Omnia AI — real prostate grading inference.

Loads the trained attention-MIL checkpoint (backend/models/omnia_prostate_v1.pt)
and runs it against a whole-slide image. This module owns exactly what the
model can actually predict: ISUP grade group and a confidence score, from
32 sampled tiles per slide, the same tissue-sampling and stain-normalization
pipeline used in training (see panda-training/kaggle/runpod_train_attn_mil.py
for the original, training-time version this was adapted from).

Runs on CPU by default — this ships in a desktop app with no guaranteed GPU,
so inference speed is bounded by that. A single slide (32 128x128 tiles,
8-way TTA, EfficientNet-B0) takes low-single-digit seconds on CPU.

Model provenance: single-fold (fold 0 of 5) attention-MIL model, validation
QWK 0.7996 on 1,827 held-out PANDA slides. Not multi-fold-ensembled, not
externally validated beyond the PANDA validation split. This is reflected in
MODEL_VERSION and should stay reflected in whatever the UI shows alongside
a result — see backend/analysis_engine.py's use of this module.
"""
import logging
import os
import random
import sys
import threading
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models import efficientnet_b0
from torchvision import transforms


def _resource_dir() -> Path:
    """Bundled data files (like the checkpoint) live next to this file in
    dev, but PyInstaller's onefile mode self-extracts datas to a temp dir
    at sys._MEIPASS at runtime — `__file__` doesn't point there once
    frozen, so this has to check for that explicitly."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "backend"
    return Path(__file__).parent


logger = logging.getLogger(__name__)

MODEL_PATH = _resource_dir() / "models" / "omnia_prostate_v1.pt"

TILE = 128
N_TILES = 32
BG_THRESHOLD = 225

# ── Concurrency and timeouts ────────────────────────────────────────────
# Analysing one slide takes tens of seconds of CPU. The analyze route is a
# sync FastAPI endpoint, so each in-flight analysis occupies one of
# Starlette's threadpool workers for that whole time. Without a cap, a
# handful of simultaneous analyses saturate that pool and the ENTIRE API —
# login, /health, everything — stops responding. Bound how many run at
# once, and make waiters fail fast with a clear error instead of piling up
# behind an unbounded queue.
_cpu_count = os.cpu_count() or 4
MAX_CONCURRENT_ANALYSES = max(1, min(2, _cpu_count // 4))
# How long a request will wait for a free analysis slot before giving up.
ANALYSIS_QUEUE_TIMEOUT_S = 120.0
# Threads each analysis hands to torch. Left unset, torch grabs every core,
# so two concurrent analyses oversubscribe the CPU and both run slower than
# one would alone.
TORCH_THREADS = max(1, _cpu_count // max(1, MAX_CONCURRENT_ANALYSES))

_analysis_slots = threading.Semaphore(MAX_CONCURRENT_ANALYSES)


class AnalysisBusyError(RuntimeError):
    """Raised when every analysis slot is occupied and the wait timed out.
    Callers should surface this as a retryable 'server busy', never as a
    generic failure — the slide is fine, the machine is just saturated."""

# The exact grade cut points fit on the training run's held-out predictions
# (see FINAL_RESULT.txt from the training session). These turn the model's
# continuous output into a discrete ISUP grade group 0-5.
GRADE_THRESHOLDS = [0.7508757603168501, 1.9708757603168512, 2.540875760316852,
                    3.0608757603168524, 4.060875760316853]

_MACENKO_REF_STAIN = np.array([[0.5626, 0.2159], [0.7201, 0.8012], [0.4062, 0.5581]])
_MACENKO_REF_MAXC = np.array([1.9705, 1.0308])
_MACENKO_ALPHA = 1.0
_MACENKO_BETA = 0.15

_TTA_VIEWS = [
    lambda x: x,
    lambda x: torch.rot90(x, 1, dims=[3, 4]),
    lambda x: torch.rot90(x, 2, dims=[3, 4]),
    lambda x: torch.rot90(x, 3, dims=[3, 4]),
    lambda x: torch.flip(x, dims=[4]),
    lambda x: torch.flip(torch.rot90(x, 1, dims=[3, 4]), dims=[4]),
    lambda x: torch.flip(torch.rot90(x, 2, dims=[3, 4]), dims=[4]),
    lambda x: torch.flip(torch.rot90(x, 3, dims=[3, 4]), dims=[4]),
]


class AttentionMIL(nn.Module):
    """Same architecture as training — must match exactly for the
    checkpoint's state_dict to load."""

    def __init__(self, n_classes=6, feat_dim=1280, attn_dim=128):
        super().__init__()
        backbone = efficientnet_b0(weights=None)  # weights come from the checkpoint
        self.features = backbone.features
        self.pool = backbone.avgpool
        self.attn_V = nn.Sequential(nn.Linear(feat_dim, attn_dim), nn.Tanh())
        self.attn_U = nn.Sequential(nn.Linear(feat_dim, attn_dim), nn.Sigmoid())
        self.attn_w = nn.Linear(attn_dim, 1)
        self.reg_head = nn.Sequential(nn.Dropout(0.3), nn.Linear(feat_dim, 1))
        self.cls_head = nn.Sequential(nn.Dropout(0.3), nn.Linear(feat_dim, n_classes))

    def embed_bag(self, tiles):
        Bsz, N = tiles.shape[0], tiles.shape[1]
        flat = tiles.view(Bsz * N, *tiles.shape[2:])
        feat = self.pool(self.features(flat)).flatten(1)
        feat = feat.view(Bsz, N, -1)
        a = self.attn_w(self.attn_V(feat) * self.attn_U(feat)).squeeze(-1)
        weights = torch.softmax(a, dim=1)
        embedding = torch.bmm(weights.unsqueeze(1), feat).squeeze(1)
        return embedding, weights

    def forward(self, tiles):
        embedding, weights = self.embed_bag(tiles)
        return self.reg_head(embedding).squeeze(-1), self.cls_head(embedding), weights


def _macenko_normalize_batch(tiles: np.ndarray) -> np.ndarray:
    """Fit stain vectors once on the pooled bag, apply to all tiles — same
    approach as training (see runpod_train_attn_mil.py's version of this
    for the reasoning: a single small tile is too noisy a sample to fit a
    stain basis from on its own)."""
    n, h, w, _ = tiles.shape
    try:
        px = tiles.reshape(-1, 3).astype(np.float64)
        od = -np.log((px + 1) / 256)
        od_thresh = od[np.all(od > _MACENKO_BETA, axis=1)]
        if od_thresh.shape[0] < 100:
            return tiles
        cov = np.cov(od_thresh.T)
        eigvals, eigvecs = np.linalg.eigh(cov)
        top2 = eigvecs[:, np.argsort(eigvals)[-2:]]
        proj = od_thresh.dot(top2)
        angles = np.arctan2(proj[:, 1], proj[:, 0])
        min_a = np.percentile(angles, _MACENKO_ALPHA)
        max_a = np.percentile(angles, 100 - _MACENKO_ALPHA)
        v1 = top2.dot(np.array([np.cos(min_a), np.sin(min_a)]))
        v2 = top2.dot(np.array([np.cos(max_a), np.sin(max_a)]))
        stain = np.array([v1, v2]).T
        if stain[0, 0] < stain[0, 1]:
            stain = stain[:, ::-1]
        stain = stain / (np.linalg.norm(stain, axis=0, keepdims=True) + 1e-8)
        conc, *_ = np.linalg.lstsq(stain, od.T, rcond=None)
        maxc = np.maximum(np.percentile(conc, 99, axis=1), 1e-6)
        conc_norm = conc * (_MACENKO_REF_MAXC / maxc)[:, None]
        od_norm = _MACENKO_REF_STAIN.dot(conc_norm)
        rgb_norm = np.clip(255 * np.exp(-od_norm), 0, 255).T.reshape(n, h, w, 3)
        return rgb_norm.astype(np.uint8)
    except Exception:
        return tiles


def _find_tile_coords(slide, max_tiles: int, seed: int):
    import cv2
    level = slide.level_count - 1
    lw, lh = slide.level_dimensions[level]
    thumb = np.asarray(slide.read_region((0, 0), level, (lw, lh)).convert("RGB"))
    gray = cv2.cvtColor(thumb, cv2.COLOR_RGB2GRAY)
    ds = slide.level_downsamples[level]
    w0, h0 = slide.dimensions
    step = max(1, int(TILE / ds))
    n_by = max(1, gray.shape[0] // step)
    n_bx = max(1, gray.shape[1] // step)
    block_means = cv2.resize(gray, (n_bx, n_by), interpolation=cv2.INTER_AREA).astype(np.float64)
    ty_idx, tx_idx = np.where(block_means <= BG_THRESHOLD)
    means = block_means[ty_idx, tx_idx]
    x0s = (tx_idx * step * ds).astype(int)
    y0s = (ty_idx * step * ds).astype(int)
    valid = (x0s < w0) & (y0s < h0)
    scored = sorted(zip(means[valid].tolist(), x0s[valid].tolist(), y0s[valid].tolist()))
    pool = scored[:min(len(scored), max_tiles * 2)] if scored else []
    if not pool:
        return [(0, 0)]
    rng = random.Random(seed)
    picked = rng.sample(pool, min(len(pool), max_tiles)) if len(pool) > max_tiles else pool
    return [(x, y) for _, x, y in picked] or [(0, 0)]


def _load_tile_bag(filepath: str):
    """Returns (tiles, coords, slide_dimensions).

    coords and dimensions come back alongside the pixels so the caller can
    map each tile's attention weight to where it actually sits on the
    slide — that's what makes a real attention heatmap possible instead of
    a decorative one.
    """
    import hashlib
    import openslide
    slide = openslide.OpenSlide(filepath)
    try:
        # Deterministic seed from the filepath — same slide always samples
        # the same tiles, so a re-run (e.g. after a crash) is reproducible.
        # Python's built-in hash() is randomized per-process (PYTHONHASHSEED)
        # by design — using it here would mean the same slide samples
        # DIFFERENT tiles across app restarts, silently breaking
        # reproducibility. Match training's own validation-time seeding
        # (see runpod_train_attn_mil.py's BagDataset.__getitem__), which
        # uses a stable hash specifically so eval is deterministic.
        seed = int(hashlib.md5(filepath.encode()).hexdigest()[:8], 16)
        coords = _find_tile_coords(slide, N_TILES, seed)
        tiles = np.zeros((N_TILES, TILE, TILE, 3), dtype=np.uint8)
        tiles[:] = 255
        for i, (x, y) in enumerate(coords[:N_TILES]):
            tiles[i] = np.asarray(slide.read_region((x, y), 0, (TILE, TILE)).convert("RGB"))
        n_real = min(len(coords), N_TILES)
        if n_real > 0:
            tiles[:n_real] = _macenko_normalize_batch(tiles[:n_real])
        if len(coords) < N_TILES and len(coords) > 0:
            for i in range(len(coords), N_TILES):
                tiles[i] = tiles[i % len(coords)]
        return tiles, coords[:N_TILES], slide.dimensions
    finally:
        slide.close()


_thumb_locks = {}
_thumb_locks_guard = threading.Lock()


def _thumb_lock_for(key: str) -> threading.Lock:
    with _thumb_locks_guard:
        lk = _thumb_locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _thumb_locks[key] = lk
        return lk


def render_thumbnail(filepath: str, max_px: int = 900, cache_dir=None) -> bytes:
    """Render the REAL slide as a PNG thumbnail, cached on disk.

    Whole-slide images are gigapixel and can't be sent to a browser
    directly, but openslide keeps a pyramid of downsampled levels — this
    reads from the smallest level big enough for `max_px` rather than
    decoding level 0, so it stays fast on a 160MB+ slide.

    Decoding still costs real seconds and memory, and a slide's pixels
    never change once uploaded, so the result is cached to disk. Without
    the cache, every viewer open (and every re-render on zoom) re-decodes
    the whole slide. A per-key lock stops two simultaneous first-views of
    the same slide from both doing that work.
    """
    import hashlib
    import io
    import openslide
    from PIL import Image

    try:
        st = os.stat(filepath)
        # Key on path + size + mtime so a replaced file can never serve a
        # stale image from a previous slide.
        key = hashlib.sha256(
            f"{filepath}:{st.st_size}:{int(st.st_mtime)}:{max_px}".encode()
        ).hexdigest()[:32]
    except OSError:
        key = None

    cache_path = None
    if key and cache_dir:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            cache_path = os.path.join(cache_dir, f"{key}.png")
            with open(cache_path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            pass
        except OSError:
            cache_path = None  # unusable cache dir — render without caching

    lock = _thumb_lock_for(key or filepath)
    with lock:
        # Another thread may have rendered it while we waited for the lock.
        if cache_path:
            try:
                with open(cache_path, "rb") as f:
                    return f.read()
            except OSError:
                pass

        slide = openslide.OpenSlide(filepath)
        try:
            thumb = slide.get_thumbnail((max_px, max_px))
            if thumb.mode != "RGB":
                thumb = thumb.convert("RGB")
            buf = io.BytesIO()
            thumb.save(buf, format="PNG", optimize=True)
            png = buf.getvalue()
        finally:
            slide.close()

        if cache_path:
            # Write-then-rename so a crash mid-write can't leave a truncated
            # PNG that every later read would serve as a valid cache hit.
            try:
                tmp = f"{cache_path}.{os.getpid()}.tmp"
                with open(tmp, "wb") as f:
                    f.write(png)
                os.replace(tmp, cache_path)
            except OSError:
                pass
        return png


def slide_dimensions(filepath: str):
    import openslide
    slide = openslide.OpenSlide(filepath)
    try:
        return slide.dimensions
    finally:
        slide.close()


_model = None
_device = None
_norm = None
_model_lock = threading.Lock()


def _get_model():
    """Lazy singleton — the checkpoint is loaded once per process, not once
    per analysis, so repeated analyses in one app session don't pay the
    load cost each time.

    api_analyze_slide is a sync FastAPI route, which Starlette runs in a
    threadpool — two slides analyzed close together (or just clicked
    quickly) run on separate threads. Without a lock, both can see
    `_model is None` and independently load the full model (each
    re-downloading nothing, but redoing ~20s of CPU work and doubling
    memory use), and there's a narrow window where one thread reads
    `_model` set by the other before `_norm` is — the three globals aren't
    assigned atomically as a group. The lock makes model init happen
    exactly once, with every other caller blocking briefly rather than
    racing."""
    global _model, _device, _norm
    if _model is not None:
        return _model, _device, _norm

    with _model_lock:
        if _model is not None:  # a concurrent caller may have finished first
            return _model, _device, _norm
        return _load_model_locked()


def reload_model() -> None:
    """Drop the cached model so the next analysis picks up a newly promoted
    checkpoint. Without this, a fine-tune would only take effect after an app
    restart, and the screen would claim the new model was in use while
    inference kept running the old weights."""
    global _model, _device, _norm
    with _model_lock:
        _model, _device, _norm = None, None, None
    logger.info("Grading model cache cleared; next analysis will reload.")


def _load_model_locked():
    global _model, _device, _norm
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Grading model not found at {MODEL_PATH}. "
            "The app was packaged without the model file, or it was moved."
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = AttentionMIL().to(device)

    # Prefer a fine-tuned checkpoint that has been promoted for this site.
    # Promotion only happens when the fine-tune agreed with the pathologist
    # better than the shipped model on held-out slides, so this is not a
    # blind preference for the newer file. Falls back to the shipped model if
    # the pointer is missing or the file has been removed.
    checkpoint = MODEL_PATH
    try:
        from backend.finetune import active_model_path
        active = active_model_path()
        if active:
            checkpoint = Path(active)
    except Exception as e:  # a broken pointer must not stop grading entirely
        logger.warning("Could not resolve active model, using shipped: %s", e)
    # weights_only=False: this is our own checkpoint bundled with the app,
    # not an untrusted download — see the training session's notes on why
    # strict weights_only loading rejects perfectly safe numpy scalar types
    # that our own save path can end up embedding.
    state = torch.load(checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(state["model"])
    model.eval()

    norm = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])

    _model, _device, _norm = model, device, norm
    return model, device, norm


def warmup() -> bool:
    """Load the model at startup instead of on the first user's request.

    Cold-loading torch + the checkpoint takes ~20s. Without this, the first
    pathologist to analyse a slide after every app launch silently pays
    that cost on top of their analysis. Returns False (and logs) rather
    than raising — a warmup failure must not stop the server from booting,
    since every other route still works without the model.
    """
    try:
        torch.set_num_threads(TORCH_THREADS)
    except Exception:
        pass
    try:
        _get_model()
        logger.info("Grading model warm (device=%s, torch_threads=%d, max_concurrent=%d)",
                    _device, TORCH_THREADS, MAX_CONCURRENT_ANALYSES)
        return True
    except Exception as e:
        logger.warning("Grading model warmup failed (%r) — analysis will error until this is resolved.", e)
        return False


@torch.no_grad()
def predict(filepath: str) -> dict:
    """Run the real model against a slide file.

    Returns only what the model can actually determine:
        {
            "grade_group": int,      # ISUP grade group, 0-5
            "confidence": float,     # 0-1, classification head's probability
                                      # mass on the predicted grade group
            "raw_score": float,      # the underlying continuous prediction,
                                      # before thresholding — useful for
                                      # audit/debugging, not for display
            "tiles_used": int,
        }

    Raises on any failure (missing model, unreadable slide, etc.) — the
    caller decides how to surface that; this module doesn't silently
    fall back to a fake result.

    Exception: OMNIA_TEST_FAKE_GRADING, an explicit opt-in for the
    integration test suite only. Real .svs/.tiff whole-slide files aren't
    something a test fixture can fake cheaply, and the test suite's dummy
    upload content (`b"x" * 1000`) is correctly rejected by real openslide
    I/O — as it should be outside tests. This env var must never be set in
    a real deployment; nothing checks for it anywhere except here.
    """
    if os.environ.get("OMNIA_TEST_FAKE_GRADING") == "1":
        return {"grade_group": 3, "confidence": 0.9, "raw_score": 3.0, "tiles_used": N_TILES,
                "slide_width": 1000, "slide_height": 1000, "regions": []}

    # Bound how many analyses run at once — see MAX_CONCURRENT_ANALYSES.
    # Fail fast when saturated rather than queueing unboundedly and taking
    # the whole API down with the threadpool.
    if not _analysis_slots.acquire(timeout=ANALYSIS_QUEUE_TIMEOUT_S):
        raise AnalysisBusyError(
            f"All {MAX_CONCURRENT_ANALYSES} analysis slots busy for over "
            f"{int(ANALYSIS_QUEUE_TIMEOUT_S)}s. Try again shortly."
        )
    try:
        return _predict_locked(filepath)
    finally:
        _analysis_slots.release()


@torch.no_grad()
def _predict_locked(filepath: str) -> dict:
    """The actual inference. Only ever entered while holding an analysis
    slot (see predict)."""
    model, device, norm = _get_model()
    tiles, coords, slide_dims = _load_tile_bag(filepath)  # (N_TILES, TILE, TILE, 3)

    t = torch.from_numpy(tiles).permute(0, 3, 1, 2).float() / 255.0  # (N,3,H,W)
    t = norm(t)
    t = t.unsqueeze(0).to(device)  # (1,N,3,H,W)

    acc = 0.0
    cls_probs_acc = None
    attn_acc = None
    for view in _TTA_VIEWS:
        reg_out, cls_out, attn = model(view(t))
        cls_prob = F.softmax(cls_out, dim=1)
        cls_expected = (cls_prob * torch.arange(6, device=device).float()).sum(1)
        acc = acc + 0.5 * reg_out.float() + 0.5 * cls_expected.float()
        cls_probs_acc = cls_prob if cls_probs_acc is None else cls_probs_acc + cls_prob
        # Attention is over tiles, and the dihedral TTA views only rotate/flip
        # pixels WITHIN each tile — they never reorder the bag — so attention
        # vectors stay aligned tile-for-tile across views and can be averaged.
        attn_acc = attn if attn_acc is None else attn_acc + attn

    raw_score = float((acc / len(_TTA_VIEWS)).item())
    mean_cls_probs = (cls_probs_acc / len(_TTA_VIEWS)).squeeze(0).cpu().numpy()
    mean_attn = (attn_acc / len(_TTA_VIEWS)).squeeze(0).cpu().numpy()

    grade_group = int(np.searchsorted(GRADE_THRESHOLDS, raw_score))
    grade_group = max(0, min(5, grade_group))
    confidence = float(mean_cls_probs[grade_group])

    # Only report attention for tiles backed by real tissue coordinates —
    # a bag padded out by cycling real tiles would otherwise emit duplicate
    # hotspots at coordinates the model never independently attended to.
    n_real = len(coords)
    regions = []
    if n_real > 0:
        real_attn = mean_attn[:n_real]
        lo, hi = float(real_attn.min()), float(real_attn.max())
        span = (hi - lo) or 1.0
        for i, (x, y) in enumerate(coords):
            regions.append({
                "x": int(x),
                "y": int(y),
                "size": TILE,
                # Raw softmax weight over 32 tiles sits near 1/32, which is
                # useless as a display value. Normalize to 0-1 across this
                # slide's own tiles so the overlay shows relative emphasis.
                "attention": round((float(real_attn[i]) - lo) / span, 4),
                "attention_raw": round(float(real_attn[i]), 6),
            })
        regions.sort(key=lambda r: -r["attention"])

    return {
        "grade_group": grade_group,
        "confidence": round(confidence, 3),
        "raw_score": round(raw_score, 4),
        "tiles_used": N_TILES,
        "slide_width": int(slide_dims[0]),
        "slide_height": int(slide_dims[1]),
        "regions": regions,
    }
