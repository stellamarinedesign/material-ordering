"""Bump the app version everywhere it lives.

    python tools/bump-version.py v0.56

Updates APP_VERSION in js/shared.js, the version comment at the top of each
js/*.js module, and the ?v= cache-busting stamp on every local script/style
tag in the four pages. The stamp matters: GitHub Pages caches every file for
~10 minutes, so a plain reload right after a deploy can be handed the OLD
js/css even though the HTML is new. A version-stamped URL is a new object to
the CDN, so a fresh page always pulls matching assets (see AutoUpdate.reloadFresh).
"""
import re, sys, os

if len(sys.argv) != 2 or not re.fullmatch(r"v\d+\.\d+(\.\d+)?", sys.argv[1]):
    sys.exit("usage: python tools/bump-version.py vX.Y[.Z]")
new = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)

def edit(path, fn):
    s = open(path, encoding="utf-8").read()
    n, count = fn(s)
    if n != s:
        open(path, "w", encoding="utf-8", newline="\n").write(n)
    print(f"{path:22s} {count} change(s)")

VER = r"v\d+\.\d+(?:\.\d+)?"

# js/shared.js — the single source of truth
edit("js/shared.js", lambda s: re.subn(rf"(const APP_VERSION = ')({VER})(')", rf"\g<1>{new}\g<3>", s))
# module headers
for js in ["js/shared.js", "js/firebase-sync.js", "js/intake.js", "js/auth.js"]:
    name = os.path.basename(js)
    edit(js, lambda s, name=name: re.subn(rf"^(// {re.escape(name)} — ){VER}", rf"\g<1>{new}", s, count=1, flags=re.M))
# cache-busting stamps on local assets
ASSETS = r"(css/style\.css|css/themes\.css|js/shared\.js|js/firebase-sync\.js|js/auth\.js|js/intake\.js)"
for page in ["index.html", "manager.html", "consumables.html", "warehouse.html"]:
    edit(page, lambda s: re.subn(rf'((?:href|src)="{ASSETS})(?:\?v={VER})?"', rf'\g<1>?v={new}"', s))
print("bumped to", new)
