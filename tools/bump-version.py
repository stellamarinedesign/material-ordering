"""Bump the app version everywhere it lives.

    python tools/bump-version.py                 next build today  (2026-10-06.1, .2, .3 …)
    python tools/bump-version.py 2026-10-07.1    a specific version

Versions are the build date plus that day's counter — the production board's
scheme — so "2026-10-06.2" is the second build on 6 Oct 2026. With no argument
the tool works out the next one itself: today's date, and the counter after
the current version's if that was also today, else 1.

Updates APP_VERSION in js/shared.js, the version comment at the top of each
js/*.js module, and the ?v= cache-busting stamp on every local script/style
tag in the four pages. The stamp matters: GitHub Pages caches every file for
~10 minutes, so a plain reload right after a deploy can be handed the OLD
js/css even though the HTML is new. A version-stamped URL is a new object to
the CDN, so a fresh page always pulls matching assets (see AutoUpdate.reloadFresh).
"""
import re, sys, os, datetime

DATE   = r"\d{4}-\d{2}-\d{2}"
DATED  = rf"{DATE}\.\d+"
LEGACY = r"v\d+\.\d+(?:\.\d+)?"            # the "v0.56" numbering used before the switch
VER    = rf"(?:v?{DATED}|{LEGACY})"

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)

shared = open("js/shared.js", encoding="utf-8").read()
m = re.search(rf"const APP_VERSION = '({VER})'", shared)
if not m:
    sys.exit("could not find APP_VERSION in js/shared.js")
current = m.group(1)

if len(sys.argv) == 1:
    today = datetime.date.today().isoformat()
    cm = re.fullmatch(rf"v?({DATE})\.(\d+)", current)             # date part, counter
    new = f"{today}.{int(cm.group(2)) + 1 if cm and cm.group(1) == today else 1}"
elif len(sys.argv) == 2 and re.fullmatch(rf"v?{DATED}", sys.argv[1]):
    new = sys.argv[1].lstrip("v")
else:
    sys.exit("usage: python tools/bump-version.py [YYYY-MM-DD.N]")

def key(v):
    return [int(n) for n in re.split(r"[.\-]", v.lstrip("v"))]
if key(new) <= key(current):
    sys.exit(f"{new} is not newer than the current {current}")

def edit(path, fn):
    s = open(path, encoding="utf-8").read()
    n, count = fn(s)
    if n != s:
        open(path, "w", encoding="utf-8", newline="\n").write(n)
    print(f"{path:22s} {count} change(s)")

# js/shared.js — the single source of truth (no "v": it's added for display)
edit("js/shared.js", lambda s: re.subn(rf"(const APP_VERSION = ')({VER})(')", rf"\g<1>{new}\g<3>", s))
# module headers
for js in ["js/shared.js", "js/firebase-sync.js", "js/intake.js", "js/auth.js", "js/catalogue.js"]:
    name = os.path.basename(js)
    edit(js, lambda s, name=name: re.subn(rf"^(// {re.escape(name)} — ){VER}", rf"\g<1>v{new}", s, count=1, flags=re.M))
# cache-busting stamps on local assets
ASSETS = r"(css/style\.css|css/themes\.css|js/shared\.js|js/firebase-sync\.js|js/auth\.js|js/intake\.js|js/catalogue\.js)"
for page in ["index.html", "manager.html", "consumables.html", "warehouse.html"]:
    edit(page, lambda s: re.subn(rf'((?:href|src)="{ASSETS})(?:\?v={VER})?"', rf'\g<1>?v={new}"', s))
print(f"bumped {current} → {new}  (shown as v{new})")
