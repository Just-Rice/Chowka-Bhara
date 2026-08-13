#!/usr/bin/env python3
"""Turn the supplied app-icon artwork into the files a home screen asks for.

The source is a presentation mockup rather than an icon: the tile floats on a
grey card with a drop shadow under it, its corners already rounded, and a
generator watermark in the corner of the page. Three things have to go before
it can be used.

  * The page. Only the tile is the icon; cropping to it takes the watermark and
    the shadow with it.
  * The rounding. iOS and Android round the icon themselves, so an icon that
    arrives pre-rounded is rounded twice and shows grey wedges at the corners.
    What is wanted is a full-bleed square for the platform to cut its own shape
    from.
  * The size. One 2048px PNG is downsampled to the sizes actually asked for,
    rather than making the phone scale five megabytes on every draw.

The corners are dealt with by cropping *inside* the arc rather than by painting
the missing wedges back in. Reconstructing them was tried first and is the
wrong tool here: the tile's edge is soft, so a region-grow walks straight
through it, and even a clean fill would be inventing artwork. The arc is about
215px on a 1290px tile and the drawing has 146px of clear margin on its
tightest side, so an inset crop loses nothing but empty background.

    python3 tools/make-icon.py "~/Downloads/CHOWKA-BHARA APP ICON.png"

Writes img/icon-<size>.png. Re-runnable; it never modifies the source.
"""

import pathlib
import sys
from PIL import Image

OUT = pathlib.Path(__file__).parent.parent / "img"
SIZES = [512, 192, 180, 167, 152, 120]     # Android, then the iOS touch icons

# Enough to clear the corner arc with room to spare, and still well outside the
# artwork. Both of those are asserted below rather than trusted.
INSET = 95


def find_tile(im):
    """The tile's bounding square. Its left and right edges are clean — the
    shadow falls below it, not beside it — so the width is measured there and
    the square follows from the top edge."""
    w, h = im.size
    px = im.load()

    def dark(p):
        return p[0] < 115 and p[1] < 115 and p[2] < 115

    row = [x for x in range(w) if dark(px[x, h // 2])]
    left, right = row[0], row[-1]
    side = right - left + 1

    # A column clear of the pale artwork in the middle, so the first dark pixel
    # really is the top edge of the tile.
    probe = left + side // 5
    top = next(y for y in range(h) if dark(px[probe, y]))
    return left, top, side


def corner_reach(im, left, top, side):
    """How far in from the edge the rounded corner cuts, at the depth we mean to
    crop to. If that is more than the crop, the crop would keep page grey."""
    px = im.load()
    page = px[6, 6]
    y = top + INSET
    x = left
    while x < left + side and max(abs(px[x, y][i] - page[i]) for i in range(3)) < 26:
        x += 1
    return x - left


def artwork_bounds(im, left, top, side):
    """Where the gold drawing actually reaches, so the crop can be checked
    against it rather than against a guess."""
    px = im.load()

    def gold(p):
        return p[0] > 150 and p[1] > 110 and p[2] < 140 and p[0] - p[2] > 60

    xs, ys = [], []
    for y in range(top, top + side, 2):
        for x in range(left, left + side, 2):
            if gold(px[x, y]):
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def main():
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                       else "~/Downloads/CHOWKA-BHARA APP ICON.png").expanduser()
    if not src.exists():
        sys.exit("not found: " + str(src))

    page = Image.open(src).convert("RGB")
    left, top, side = find_tile(page)
    print("  source %dx%d, tile %dx%d at (%d, %d)" % (page.size + (side, side, left, top)))

    reach = corner_reach(page, left, top, side)
    if reach > INSET:
        sys.exit("the corner still cuts %dpx in at an inset of %d — raise INSET"
                 % (reach, INSET))
    print("  corner clears the crop by %d px" % (INSET - reach))

    ax0, ay0, ax1, ay1 = artwork_bounds(page, left, top, side)
    margin = min(ax0 - left, ay0 - top, left + side - ax1, top + side - ay1) - INSET
    if margin < 0:
        sys.exit("an inset of %d would clip the drawing by %d px" % (INSET, -margin))
    print("  drawing keeps %d px of margin" % margin)

    tile = page.crop((left + INSET, top + INSET,
                      left + side - INSET, top + side - INSET))
    print("  cropped to %dx%d" % tile.size)

    OUT.mkdir(exist_ok=True)
    master = tile.resize((1024, 1024), Image.LANCZOS)
    for size in SIZES:
        f = OUT / ("icon-%d.png" % size)
        master.resize((size, size), Image.LANCZOS).save(f, optimize=True)
        print("  %-14s %4d x %-4d %3dK" % (f.name, size, size, f.stat().st_size // 1024))


if __name__ == "__main__":
    main()
