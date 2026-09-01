"""Generate the Omnia Pathology AI app icon.

Keeps the existing identity — the neon heartbeat/pulse — but presents it as a
modern iOS-style rounded square (squircle) instead of a bare circle.

Two problems with the previous asset this fixes:
  * it was RGB with a *painted* checkerboard, so the "transparency" showed up as
    a grey checked square wherever the logo was placed in the UI
  * a plain circle looks dated next to current macOS/iOS icon conventions

Run:  .venv/bin/python scripts/make-app-icon.py
Writes desktop/icon.png (1024), public/brand-mark.png, app/icon.png.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # master size

# Sky-blue clinical palette, matching --accent in app/globals.css so the icon
# on the dock and the accent inside the window are recognisably the same
# product. The ground stays deep so the icon reads on both a light and a dark
# desktop; the pulse carries the sky blue.
BG_TOP = (14, 74, 110)      # deep sky, sky-900-ish
BG_BOTTOM = (7, 32, 51)
RING = (56, 132, 178)
NEON = (56, 189, 248)       # sky-400 — same family as --accent
NEON_CORE = (224, 247, 255)


def squircle_mask(size, radius_ratio=0.2237):
    """Apple-style continuous-corner mask (approximated with a rounded rect)."""
    m = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(m)
    r = int(size * 4 * radius_ratio)
    d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=r, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def vertical_gradient(size, top, bottom):
    g = Image.new("RGB", (1, size))
    px = g.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        )
    return g.resize((size, size), Image.BICUBIC)


def pulse_points(size):
    """The heartbeat trace: flat, small bump, tall spike, deep trough, bump, flat."""
    cx, cy = size / 2, size / 2
    w = size * 0.66
    x0 = cx - w / 2
    def px(f): return x0 + w * f
    def py(f): return cy - size * f
    return [
        (px(0.00), py(0.00)),
        (px(0.20), py(0.00)),
        (px(0.27), py(0.075)),
        (px(0.33), py(-0.055)),
        (px(0.44), py(0.245)),
        (px(0.56), py(-0.235)),
        (px(0.64), py(0.075)),
        (px(0.71), py(0.00)),
        (px(1.00), py(0.00)),
    ]


def build_icon(size=S):
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA")

    # Soft top-left sheen so the flat square reads as a physical surface.
    sheen = Image.new("L", (size, size), 0)
    ImageDraw.Draw(sheen).ellipse(
        [-size * 0.35, -size * 0.6, size * 0.95, size * 0.5], fill=64
    )
    sheen = sheen.filter(ImageFilter.GaussianBlur(size * 0.10))
    grad = Image.composite(Image.new("RGBA", (size, size), (255, 255, 255, 255)), grad, sheen).convert("RGBA")
    grad = Image.blend(vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA"), grad, 0.16)

    base.paste(grad, (0, 0))

    # Subtle inner ring, echoing the original bezel without the heavy chrome.
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    inset = size * 0.085
    rd.ellipse([inset, inset, size - inset, size - inset],
               outline=RING + (150,), width=max(2, int(size * 0.006)))
    base = Image.alpha_composite(base, ring)

    # Neon pulse: wide blurred glow, then a bright core stroke.
    pts = pulse_points(size)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line(pts, fill=NEON + (255,), width=int(size * 0.055), joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.032))
    base = Image.alpha_composite(base, glow)

    mid = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(mid).line(pts, fill=NEON + (255,), width=int(size * 0.030), joint="curve")
    mid = mid.filter(ImageFilter.GaussianBlur(size * 0.006))
    base = Image.alpha_composite(base, mid)

    core = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(core).line(pts, fill=NEON_CORE + (255,), width=int(size * 0.016), joint="curve")
    base = Image.alpha_composite(base, core)

    # Clip everything to the squircle — real alpha, no painted checkerboard.
    base.putalpha(squircle_mask(size))
    return base


def main():
    icon = build_icon()
    out = [
        os.path.join(ROOT, "desktop", "icon.png"),
        os.path.join(ROOT, "public", "brand-mark.png"),
        os.path.join(ROOT, "app", "icon.png"),
    ]
    for p in out:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        icon.save(p)
        print("wrote", os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
