#!/usr/bin/env python3
"""Stamp a version onto every stylesheet and script index.html loads.

Without this, a browser can pair a freshly fetched index.html with a cached
script from an earlier release. That combination is not a version anyone ever
tested: new markup, old code. It once left the setup screen with no text at all,
because the old script referenced an element the new markup had dropped, threw,
and never reached the line that fills the words in.

A version in the query string makes each release's assets distinct URLs, so the
pairing cannot happen.

    python3 tools/stamp-assets.py 1.5.2
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: stamp-assets.py <version>")
    version = sys.argv[1].lstrip("v")

    page = ROOT / "index.html"
    s = page.read_text()

    def stamp(m):
        attr, path = m.group(1), m.group(2)
        clean = path.split("?")[0]
        return '%s="%s?v=%s"' % (attr, clean, version)

    s, n = re.subn(r'(src|href)="((?:js|css|img)/[^"]+?)"', stamp, s)
    page.write_text(s)
    print("  stamped %d asset references with v%s" % (n, version))


if __name__ == "__main__":
    main()
