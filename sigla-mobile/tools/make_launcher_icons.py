"""Generate the SigLa launcher icons from sigla-admin/public/favicon-256.svg.

The SVG's first <path> is the blue rounded tile; everything after it is the
artwork. Dropping the tile and rendering with alpha gives the adaptive-icon
foreground directly, and the tile colour becomes the adaptive background.

Usage (from sigla-mobile/, see README.md):
    python tools/make_launcher_icons.py ../sigla-admin/public/favicon-256.svg app/src/main/res
"""
import io
import os
import re
import sys

import pymupdf
from PIL import Image, ImageDraw

SVG, RES = sys.argv[1], sys.argv[2]
BLUE = (26, 56, 126)   # the tile path's fill in the SVG
# The SVG's 1024-unit viewBox maps onto the 72dp the launcher mask shows, so the
# icon reproduces the logo tile exactly. Centre on the viewBox, NOT the
# artwork's bounding box: the sparkles, raised finger and left wave dashes make
# that box lopsided (centre ~(481, 461) vs the tile's (512, 512)), and centring
# it pushed the whole logo down and right on the home screen.
VIEWBOX_DP = 72
RENDER_PX = 3072       # render once, large, then downsample per density

svg = open(SVG, encoding="utf-8").read()
tile = re.search(r'<path[^>]*fill="rgb\(26,56,126\)"[^>]*d="M 215\.688[^"]*"\s*/>', svg)
assert tile, "tile path not found; SVG changed?"
art_svg = svg[:tile.start()] + svg[tile.end():]

doc = pymupdf.open(stream=art_svg.encode("utf-8"), filetype="svg")
page = doc[0]
zoom = RENDER_PX / page.rect.width
pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
# Full viewBox, uncropped, so the tile centre stays the image centre.
art = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")


def place(im, frac):
    """Composite the viewBox render centred on im, at frac of its width."""
    n = round(im.width * frac)
    a = art.resize((n, n), Image.LANCZOS)
    im.alpha_composite(a, ((im.width - n) // 2, (im.height - n) // 2))
    return im


def on_blue(size, frac):
    return place(Image.new("RGBA", (size, size), BLUE + (255,)), frac)


DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

for d, s in DENS.items():
    out = os.path.join(RES, f"mipmap-{d}")
    os.makedirs(out, exist_ok=True)

    canvas = round(108 * s)
    fg = place(Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0)), VIEWBOX_DP / 108)
    fg.save(os.path.join(out, "ic_launcher_foreground.webp"), lossless=True)

    # Legacy 48dp icons (API 24-25), supersampled for clean mask edges.
    n = round(48 * s)
    big = n * 4
    for name, frac, draw in (
        # The viewBox IS the tile, so the rounded square is the logo as drawn.
        ("ic_launcher", 1.0,
         lambda dr: dr.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.2, fill=255)),
        # Farthest artwork point (top sparkle) is ~498 units from centre;
        # 0.97 keeps it inside the circle's 512.
        ("ic_launcher_round", 0.97,
         lambda dr: dr.ellipse((0, 0, big - 1, big - 1), fill=255)),
    ):
        m = Image.new("L", (big, big), 0)
        draw(ImageDraw.Draw(m))
        im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        im.paste(on_blue(big, frac), (0, 0), m)
        im.resize((n, n), Image.LANCZOS).save(os.path.join(out, f"{name}.webp"), lossless=True)

print("done")
