"""Splash icon: logo artwork with the "SigLa" name under it, as ONE image.

The system splash (Android 12+ / core-splashscreen) draws its icon on a 288dp
canvas and masks it to the central 192dp circle, so logo and name must both fit
inside that circle. SplashActivity shows the same drawable at the same size, so
the whole frame is identical from the first system-splash frame onward.

Usage (from sigla-mobile/, see README.md):
    python tools/make_splash_icon.py ../sigla-admin/public/favicon-256.svg         app/src/main/res/font/poppins_semibold.ttf         app/src/main/res/drawable-xxxhdpi/splash_icon.webp [preview.png]
"""
import io
import math
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

SVG, FONT, OUT = sys.argv[1:4]
PREVIEW = sys.argv[4] if len(sys.argv) > 4 else None

PX_PER_DP = 4                  # xxxhdpi; lower densities are scaled down by Android
CANVAS = 288 * PX_PER_DP       # splash icon canvas
RADIUS = 96 * PX_PER_DP        # visible circle (192dp diameter)
MARGIN = 6 * PX_PER_DP         # keep everything this far inside the circle
TEXT = "SigLa"
TEXT_TO_ART = 0.15             # name cap height relative to the logo tile width
GAP_TO_ART = 0.07              # gap between artwork bottom and name, of tile width

svg = open(SVG, encoding="utf-8").read()
tile = re.search(r'<path[^>]*fill="rgb\(26,56,126\)"[^>]*d="M 215\.688[^"]*"\s*/>', svg)
assert tile, "tile path not found; SVG changed?"
art_svg = svg[:tile.start()] + svg[tile.end():]
page = pymupdf.open(stream=art_svg.encode("utf-8"), filetype="svg")[0]
zoom = 3072 / page.rect.width
full = Image.open(io.BytesIO(page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
                            .tobytes("png"))).convert("RGBA")
# Crop vertically only. Horizontally keep the full viewBox so the logo centres on
# its tile, as the launcher icon does: the artwork's own box is lopsided (left
# wave dashes reach further out than the right ones).
bb = full.getbbox()
art = full.crop((0, bb[1], full.width, bb[3]))


def compose(tile_px):
    """Logo (viewBox scaled to tile_px wide) stacked over the name, centred."""
    k = tile_px / full.width
    a = art.resize((round(art.width * k), round(art.height * k)), Image.LANCZOS)
    font = ImageFont.truetype(FONT, size=10)
    # Size the font so the name's cap height is TEXT_TO_ART of the tile width.
    cap = font.getbbox("S")[3] - font.getbbox("S")[1]
    font = ImageFont.truetype(FONT, size=max(1, round(10 * TEXT_TO_ART * tile_px / cap)))
    tb = font.getbbox(TEXT)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    gap = round(GAP_TO_ART * tile_px)
    h = a.height + gap + th
    im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    top = (CANVAS - h) // 2
    im.alpha_composite(a, ((CANVAS - a.width) // 2, top))
    ImageDraw.Draw(im).text(((CANVAS - tw) // 2 - tb[0], top + a.height + gap - tb[1]),
                            TEXT, font=font, fill=(255, 255, 255, 255))
    return im


def fits(im):
    c = CANVAS / 2
    px = im.getchannel("A").load()
    for y in range(0, CANVAS, 2):
        for x in range(0, CANVAS, 2):
            if px[x, y] > 8 and math.hypot(x - c, y - c) > RADIUS - MARGIN:
                return False
    return True


lo, hi = 100, CANVAS
while hi - lo > 2:                     # largest tile width that still fits the circle
    mid = (lo + hi) // 2
    lo, hi = (mid, hi) if fits(compose(mid)) else (lo, mid)
icon = compose(lo)
print(f"tile width {lo}px = {lo / PX_PER_DP:.0f}dp")
icon.save(OUT, lossless=True)

if PREVIEW:
    blue = Image.new("RGBA", (CANVAS, CANVAS), (26, 56, 126, 255))
    blue.alpha_composite(icon)
    d = ImageDraw.Draw(blue)
    c = CANVAS / 2
    d.ellipse((c - RADIUS, c - RADIUS, c + RADIUS, c + RADIUS), outline=(255, 80, 80, 255), width=3)
    blue.convert("RGB").resize((CANVAS // 2, CANVAS // 2), Image.LANCZOS).save(PREVIEW)
