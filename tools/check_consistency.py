#!/usr/bin/env python3
"""CI drift check for AI Frontier Post.

Verifies the generated artifacts stay consistent with the source of truth
(posts.json + articles/):

1. posts.json parses; slugs unique; required fields present; dates valid.
2. Every posts.json slug has articles/<slug>/index.html, and vice versa.
3. Category page card counts + "All N <Cat> stories" copy match posts.json.
4. sitemap.xml contains every article URL exactly once.
5. index.html carries no article bodies, no base64 images, no legacy hash routes.
6. feed.xml / news-sitemap.xml are fresh (delegates to build_feed.py --check).

Exit non-zero with a list of problems on any drift.
"""
import json, os, re, subprocess, sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root (CI checkout or local)
os.chdir(REPO)
problems = []


def fail(msg):
    problems.append(msg)


# 1. posts.json
try:
    posts = json.load(open("posts.json"))
except Exception as e:
    fail(f"posts.json unreadable: {e}")
    posts = []
slugs = [p.get("slug") for p in posts]
if len(slugs) != len(set(slugs)):
    fail("duplicate slugs in posts.json")
req = {"title", "slug", "thumbnail", "category", "excerpt", "tags", "author",
       "date", "reading_minutes", "sponsored"}
for p in posts:
    if set(p.keys()) != req:
        fail(f"{p.get('slug')}: fields {sorted(set(p.keys()) ^ req)} differ")
    try:
        datetime.strptime(p["date"], "%Y-%m-%d")
    except Exception:
        fail(f"{p.get('slug')}: bad date {p.get('date')!r}")
    t = p.get("thumbnail")
    if t and not os.path.exists("." + t):
        fail(f"{p.get('slug')}: thumbnail missing: {t}")

# 2. posts.json <-> articles/
art_dirs = {d for d in os.listdir("articles") if os.path.isdir(f"articles/{d}")}
slug_set = set(slugs)
for s in slug_set - art_dirs:
    fail(f"posts.json slug without article dir: {s}")
for d in art_dirs - slug_set:
    if not os.path.exists(f"articles/{d}/index.html"):
        fail(f"articles/{d}/ has no index.html")
    else:
        fail(f"article dir not in posts.json: {d}")

# 3. category pages
CATS = {"AI News": "ai-news", "Research": "research",
        "Frontier Labs": "frontier-labs", "Tutorials": "tutorials",
        "Reviews": "reviews"}
from collections import Counter
counts = Counter(p["category"] for p in posts)
for cat, path in CATS.items():
    html = open(f"category/{path}/index.html").read()
    cards = len(set(re.findall(r"/articles/([a-z0-9-]+)/", html)))
    n = counts.get(cat, 0)
    if cards != n:
        fail(f"category/{path}: {cards} cards but posts.json has {n} {cat}")
    for m in set(re.findall(r"All (\d+) [A-Za-z ]*?stories", html)):
        if int(m) != n:
            fail(f"category/{path}: copy says {m} stories, truth is {n}")

# 4. sitemap.xml
sm = open("sitemap.xml").read()
for s in slug_set:
    url = f"https://aifrontierpost.com/articles/{s}/"
    c = sm.count(url)
    if c != 1:
        fail(f"sitemap.xml contains {url} {c}x (want 1)")

# 5. index.html stays slim
idx = open("index.html").read()
for needle, why in [
    ("EXISTING_POSTS", "inline article data"),
    ("body_html", "inline article body"),
    ("data:image", "base64 image"),
    ('href="#post/', "legacy hash route"),
    ('href="#category/', "legacy hash route"),
    ('href="#about"', "legacy hash route"),
]:
    if needle in idx:
        fail(f"index.html contains {why}: {needle}")
if len(idx) > 200_000:
    fail(f"index.html is {len(idx)} bytes (>200k budget)")

# 6. feeds fresh
r = subprocess.run([sys.executable, "tools/build_feed.py", "--check"],
                   capture_output=True, text=True)
if r.returncode != 0:
    fail("feed.xml/news-sitemap.xml stale:\n" + r.stdout.strip())

if problems:
    print("CONSISTENCY FAILURES:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print(f"OK: {len(posts)} posts, {len(CATS)} category pages, sitemap, feeds all consistent")
