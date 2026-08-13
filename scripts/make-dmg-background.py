"""Generate the DMG installer background for Omnia Pathology AI.

The installer window previously had no background at all, which made it look
unfinished. This renders a clean clinical-software backdrop with the product
name, an install instruction, and a drag arrow pointing from the app icon
position to the Applications alias.

Run:  .venv/bin/python scripts/make-dmg-background.py
Output: build/dmg-background.png  and  build/dmg-background@2x.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "build")

# Finder window content size (points). Icon coordinates in package.json must match.
W, H = 640, 420
SCALE = 2  # retina

BG_TOP = (250, 251, 253)
BG_BOTTOM = (238, 242, 247)
NAVY = (16, 38, 68)
SLATE = (110, 124, 143)
ACCENT = (0, 122, 255)
HAIRLINE = (214, 222, 232)

FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNSDisplay.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]


def load_font(size, bold=False):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=1 if (bold and path.endswith(".ttc")) else 0)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_background(scale):
    w, h = W * scale, H * scale
    img = Image.new("RGB", (w, h), BG_TOP)
    d = ImageDraw.Draw(img)

    # Soft vertical gradient
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line(
            [(0, y), (w, y)],
            fill=(
                int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            ),
        )

    title_f = load_font(23 * scale, bold=True)
    sub_f = load_font(13 * scale)
    step_f = load_font(12 * scale)
    foot_f = load_font(10 * scale)

    def centered(text, font, y, fill):
        tw = d.textbbox((0, 0), text, font=font)[2]
        d.text(((w - tw) / 2, y), text, font=font, fill=fill)

    centered("Omnia Pathology AI", title_f, 34 * scale, NAVY)
    centered("Clinical Trial Pathology Suite", sub_f, 68 * scale, SLATE)

    # Hairline separator under the header
    d.line([(70 * scale, 96 * scale), ((W - 70) * scale, 96 * scale)], fill=HAIRLINE, width=max(1, scale // 2))

    # Instruction above the icons
    centered("To install, drag the app into your Applications folder",
             step_f, 120 * scale, SLATE)

    # Drag arrow between the two icon slots (icons sit at y=250 in window points)
    cy = 250 * scale
    x_from, x_to = 232 * scale, 408 * scale
    d.line([(x_from, cy), (x_to - 14 * scale, cy)], fill=ACCENT, width=max(2, 2 * scale))
    d.polygon(
        [
            (x_to, cy),
            (x_to - 15 * scale, cy - 9 * scale),
            (x_to - 15 * scale, cy + 9 * scale),
        ],
        fill=ACCENT,
    )

    centered("Research Use Only · Not for clinical diagnosis",
             foot_f, (H - 40) * scale, SLATE)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    draw_background(1).save(os.path.join(OUT_DIR, "dmg-background.png"))
    draw_background(SCALE).save(os.path.join(OUT_DIR, "dmg-background@2x.png"))
    print("Wrote build/dmg-background.png and build/dmg-background@2x.png")


if __name__ == "__main__":
    main()
