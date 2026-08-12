#!/usr/bin/env python3
"""Turn the generated artwork into game-ready assets.

The source images come out of an image model, which means three things need
undoing before they can be used:

  * they carry a watermark near an edge, so the outer band is cropped away
  * they have no alpha channel, so the flat magenta backdrop is keyed out
  * they occasionally include a stray extra object, so only the largest
    connected shape is kept

Textures are handled differently: they fill their frame deliberately, so a
clean region is cut from the middle and mirrored into something that tiles.

    python3 tools/process-art.py "~/Downloads/CHOWKA-BHARA IMAGES"

Writes into img/. Re-runnable; it never modifies the sources.
"""

import colorsys
import pathlib
import sys
from PIL import Image, ImageFilter

OUT = pathlib.Path(__file__).parent.parent / "img"

# name in the source folder -> name we ship
KEYED = {
    "Cowrie Up.png":    "cowrie-up.png",
    "Cowrie Down.png":  "cowrie-down.png",
    "Token Red.png":    "token-red.png",
    "Token Blue.png":   "token-blue.png",
    "Token Yellow.png": "token-yellow.png",
    "Token Green.png":  "token-green.png",
    "Safe Marker.png":  "safe-marker.png",
}
# Textures carry no transparency, so they ship as JPEG — a fifth of the weight
# of PNG for the same look, and these are quiet backgrounds where compression
# artefacts have nothing to cling to.
TEXTURES = {
    # source: (output, size, tile seamlessly?)
    "Board Tile.png":   ("board-tile.jpg", 512, True),
    "Mat Texture.png":  ("mat-texture.jpg", 512, True),
    "Center Home.png":  ("centre-home.jpg", 512, False),
}

CROP = 0.08          # fraction trimmed from every edge, to lose the watermark
SIZE = 256           # exported size; pieces render around 50px, so this is
                     # already generous even on a retina screen
MARGIN = 0.06        # breathing room left around a subject


def is_magenta(r, g, b):
    """The backdrop, allowing for the model rendering it as a soft pink."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return 0.74 < h < 0.96 and s > 0.22 and v > 0.28


def near_edge(px, x, y, w, h):
    """Is this pixel next to the backdrop? Those are the ones that blend with
    it and pick up the worst of the colour cast."""
    for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and is_magenta(*px[nx, ny]):
            return True
    return False


def key_out_background(im):
    """Alpha from the magenta backdrop, with the colour fringe pulled off the
    edges so the subject does not keep a pink halo."""
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if is_magenta(r, g, b):
                ap[x, y] = 0
            else:
                # Despill: magenta is red plus blue, so a pixel whose green sits
                # below both is carrying some backdrop. Edge pixels are part
                # backdrop by definition, so correct them hardest — that is
                # where a pink halo would otherwise show.
                if b > g and r > g:
                    spill = min(r, b) - g
                    if spill > 4:
                        edge = 1.0 if near_edge(px, x, y, w, h) else 0.45
                        cut = int(spill * 0.75 * edge)
                        px[x, y] = (max(0, r - cut), g, max(0, b - cut))

    # Pixels right on the boundary are part subject, part backdrop, and no
    # amount of colour correction saves them — they read as a pink rim. Pulling
    # the edge in by a pixel removes them outright. MinFilter(3) is deliberately
    # gentle: a heavier erosion would eat thin shapes like the safe marker's
    # outline.
    alpha = alpha.filter(ImageFilter.MinFilter(3))

    out = im.convert("RGBA")
    out.putalpha(alpha.filter(ImageFilter.GaussianBlur(1.0)))
    return out


def largest_shape_only(rgba):
    """Drop anything that is not part of the main subject. The model sometimes
    adds a second, half-drawn object; this removes it without hand-editing."""
    w, h = rgba.size
    small = rgba.resize((160, 160)).getchannel("A").point(lambda v: 255 if v > 100 else 0)
    mask = small.load()

    seen = [[False] * 160 for _ in range(160)]
    best, best_size = None, 0
    for sy in range(160):
        for sx in range(160):
            if seen[sy][sx] or mask[sx, sy] == 0:
                continue
            stack, cells = [(sx, sy)], []
            seen[sy][sx] = True
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < 160 and 0 <= ny < 160 and not seen[ny][nx] and mask[nx, ny]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(cells) > best_size:
                best, best_size = cells, len(cells)

    if not best or best_size < 20:
        return rgba, 1

    shapes = 0
    seen2 = [[False] * 160 for _ in range(160)]
    for sy in range(160):
        for sx in range(160):
            if not seen2[sy][sx] and mask[sx, sy]:
                shapes += 1
                stack = [(sx, sy)]
                seen2[sy][sx] = True
                while stack:
                    x, y = stack.pop()
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < 160 and 0 <= ny < 160 and not seen2[ny][nx] and mask[nx, ny]:
                            seen2[ny][nx] = True
                            stack.append((nx, ny))

    keep = Image.new("L", (160, 160), 0)
    kp = keep.load()
    for x, y in best:
        kp[x, y] = 255
    keep = keep.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))

    a = rgba.getchannel("A")
    rgba.putalpha(Image.eval(Image.merge("L", [a]), lambda v: v).point(lambda v: v))
    combined = Image.new("L", (w, h))
    ap, kpx, cp = a.load(), keep.load(), combined.load()
    for y in range(h):
        for x in range(w):
            cp[x, y] = ap[x, y] * kpx[x, y] // 255
    rgba.putalpha(combined)
    return rgba, shapes


def square_around_subject(rgba):
    box = rgba.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box:
        return rgba
    sub = rgba.crop(box)
    side = int(max(sub.size) * (1 + MARGIN * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(sub, ((side - sub.width) // 2, (side - sub.height) // 2))
    return canvas


def seamless(im):
    """Mirror into a tile that repeats without a visible seam. Fine for a
    woven or grain texture, where the symmetry does not read."""
    w, h = im.size
    out = Image.new("RGB", (w * 2, h * 2))
    out.paste(im, (0, 0))
    out.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    out.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    out.paste(im.transpose(Image.ROTATE_180), (w, h))
    return out


def main():
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                       else "~/Downloads/CHOWKA-BHARA IMAGES").expanduser()
    if not src.is_dir():
        sys.exit("not a folder: " + str(src))
    OUT.mkdir(exist_ok=True)

    for name, out_name in KEYED.items():
        f = src / name
        if not f.exists():
            print(f"  {name:18} MISSING — skipped")
            continue
        im = Image.open(f)
        w, h = im.size
        c = (int(w * CROP), int(h * CROP), int(w * (1 - CROP)), int(h * (1 - CROP)))
        im = im.crop(c).resize((640, 640), Image.LANCZOS)

        rgba = key_out_background(im)
        rgba, shapes = largest_shape_only(rgba)
        rgba = square_around_subject(rgba).resize((SIZE, SIZE), Image.LANCZOS)
        rgba.save(OUT / out_name)
        note = f"  ({shapes} shapes found, kept the largest)" if shapes > 1 else ""
        print(f"  {out_name:18} {SIZE}x{SIZE} RGBA{note}")

    for name, (out_name, size, tile) in TEXTURES.items():
        f = src / name
        if not f.exists():
            print(f"  {name:18} MISSING — skipped")
            continue
        im = Image.open(f).convert("RGB")
        w, h = im.size
        side = int(min(w, h) * (1 - CROP * 2))
        im = im.crop(((w - side) // 2, (h - side) // 2,
                      (w + side) // 2, (h + side) // 2))
        if tile:
            im = seamless(im.resize((size, size), Image.LANCZOS))
        im = im.resize((size, size), Image.LANCZOS)
        im.save(OUT / out_name, quality=86, optimize=True, progressive=True)
        kb = (OUT / out_name).stat().st_size // 1024
        print(f"  {out_name:18} {size}x{size}  {kb}K{'  seamless' if tile else ''}")


if __name__ == "__main__":
    main()
