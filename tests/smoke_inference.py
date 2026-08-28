"""End-to-end inference smoke test for a packaged build.

Why this exists
---------------
The Windows release check previously confirmed that the bundled backend
started and that OpenSlide, torch and the model checkpoint were *importable*.
That is not the same as being able to grade a slide, and the gap between the
two is exactly where a clinical user would hit a wall:

  - `openslide.__library_version__` returning "1.4.6" proves the DLL loaded.
    It does not prove the driver can open a slide file and read tiles.
  - `import torch` succeeding does not prove a forward pass runs, or that the
    checkpoint's weights load into the architecture.

This runs the real path: build a slide file, open it through OpenSlide, sample
tiles, run the model, and require a valid ISUP grade group out the other end.

The slide is generated rather than committed. OpenSlide's generic-tiff driver
reads tiled TIFFs, so a few megabytes of synthetic tissue exercises the same
code as a 60 GB scan without putting a large binary in the repository. The
grade it produces is meaningless — the point is that the pipeline runs, not
what it says about noise.
"""
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FAILURES = []


def check(name: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if not ok else ""))
    if not ok:
        FAILURES.append(name)


def make_slide(path: str, size: int = 2048) -> None:
    """Write a tiled TIFF that OpenSlide can open as a slide.

    Tissue-like structure matters: the tile sampler skips background, so a
    uniform image would yield no usable tiles and the test would pass or fail
    for the wrong reason.
    """
    import numpy as np
    import tifffile

    rng = np.random.RandomState(0)
    img = np.full((size, size, 3), 240, dtype=np.uint8)  # pale background

    # A stained-looking band across the middle, plus texture.
    yy, xx = np.mgrid[0:size, 0:size]
    band = (np.abs(yy - size // 2) < size // 5)
    img[band] = [200, 120, 170]
    img = np.clip(img.astype(np.int16)
                  + rng.randint(-25, 25, (size, size, 3)), 0, 255).astype(np.uint8)

    tifffile.imwrite(path, img, tile=(256, 256), photometric="rgb")


def main() -> int:
    print("=== END-TO-END INFERENCE SMOKE TEST ===")

    import openslide
    print(f"  OpenSlide library {openslide.__library_version__}")

    tmp = Path(tempfile.mkdtemp())
    slide_path = str(tmp / "smoke_slide.tiff")
    make_slide(slide_path)
    check("slide file written", Path(slide_path).exists())

    # 1. OpenSlide must actually OPEN the file, not merely be importable.
    fmt = openslide.OpenSlide.detect_format(slide_path)
    check("OpenSlide recognises the slide format", fmt is not None, f"got {fmt}")
    with openslide.OpenSlide(slide_path) as s:
        dims = s.dimensions
        region = s.read_region((64, 64), 0, (128, 128))
    check("OpenSlide reads a tile region", region.size == (128, 128), f"got {region.size}")

    # 2. The checkpoint must load into the architecture.
    from backend import grading_model as gm
    t0 = time.time()
    model, device, _norm = gm._get_model()
    check("model checkpoint loads", model is not None, "model failed to load")
    print(f"        loaded in {time.time() - t0:.1f}s on {device}")

    # 3. The full inference path must produce a usable grade.
    t0 = time.time()
    result = gm.predict(slide_path)
    elapsed = time.time() - t0

    gg = result.get("grade_group")
    check("inference returns an ISUP grade group",
          isinstance(gg, int) and 0 <= gg <= 5, f"got {gg!r}")
    check("inference returns a confidence",
          isinstance(result.get("confidence"), float) and 0.0 <= result["confidence"] <= 1.0,
          f"got {result.get('confidence')!r}")
    check("inference reports the tiles it used",
          result.get("tiles_used", 0) > 0, f"got {result.get('tiles_used')}")
    check("slide dimensions are read from the file",
          result.get("slide_width") == dims[0] and result.get("slide_height") == dims[1],
          f"got {result.get('slide_width')}x{result.get('slide_height')}, file is {dims[0]}x{dims[1]}")

    # Attention is what the interface renders over the slide; an empty list
    # means the overlay would silently show nothing.
    regions = result.get("regions") or []
    check("attention weights are produced", len(regions) > 0, "no attention regions returned")
    if regions:
        check("attention weights are normalised 0-1",
              all(0.0 <= r["attention"] <= 1.0 for r in regions), "weight out of range")

    print(f"\n  grade group {gg}  ·  confidence {result.get('confidence')}  ·  "
          f"{result.get('tiles_used')} tiles  ·  {elapsed:.1f}s")
    print("  (the grade itself is meaningless on synthetic tissue — "
          "this proves the pipeline runs)")

    print("\n" + "=" * 52)
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} -> {', '.join(FAILURES)}")
        return 1
    print("All inference checks passed on this platform.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
