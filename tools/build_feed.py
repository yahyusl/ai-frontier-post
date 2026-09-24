#!/usr/bin/env python3
"""Regenerate feed.xml (RSS 2.0) and news-sitemap.xml (Google News) from posts.json.

Run after every publish from the repo root:
    python3 tools/build_feed.py
Use --check in CI: regenerates to memory and fails if feed.xml or
news-sitemap.xml differ from what's committed.

The feed carries 25 summary items (title + excerpt + thumbnail enclosure) —
full article bodies live on the article pages, not in the feed.
"""
import json, html, sys
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

SITE = "https://aifrontierpost.com"
REPO = "/home/hatch/workspace/ai-frontier-post"
FEED_ITEMS = 25

posts = json.load(open(f"{REPO}/posts.json"))


def dt(p):
    return datetime.strptime(p["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)


posts.sort(key=dt, reverse=True)
esc = lambda s: html.escape(s or "", quote=True)

# ---------- feed.xml ----------
items = []
for p in posts[:FEED_ITEMS]:
    url = f"{SITE}/articles/{p['slug']}/"
    img = p.get("thumbnail") or ""
    if img.startswith("/"):
        img = SITE + img
    item = [
        "<item>",
        f"<title>{esc(p['title'])}</title>",
        f"<link>{esc(url)}</link>",
        f"<guid isPermaLink=\"true\">{esc(url)}</guid>",
        f"<pubDate>{format_datetime(dt(p))}</pubDate>",
        f"<category>{esc(p.get('category', ''))}</category>",
        f"<dc:creator>{esc(p.get('author', 'AI Frontier Post'))}</dc:creator>",
        f"<description>{esc(p.get('excerpt') or '')}</description>",
    ]
    if img:
        item.append(f"<enclosure url=\"{esc(img)}\" type=\"image/webp\"/>")
    item.append("</item>")
    items.append("\n".join(item))

feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>AI Frontier Post</title>
<link>{SITE}/</link>
<description>Dispatches from the AI frontier: AI news, research explainers, frontier lab coverage, and product comparisons.</description>
<language>en</language>
<lastBuildDate>{format_datetime(datetime.now(timezone.utc))}</lastBuildDate>
<atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom"/>
{chr(10).join(items)}
</channel>
</rss>"""

# ---------- news-sitemap.xml (Google News: articles < 2 days old) ----------
cutoff = datetime.now(timezone.utc) - timedelta(days=2)
news_urls = []
for p in posts:
    if dt(p) < cutoff:
        continue
    url = f"{SITE}/articles/{p['slug']}/"
    news_urls.append(f"""<url>
<loc>{esc(url)}</loc>
<news:news>
<news:publication><news:name>AI Frontier Post</news:name><news:language>en</news:language></news:publication>
<news:publication_date>{dt(p).strftime('%Y-%m-%dT%H:%M:%S+00:00')}</news:publication_date>
<news:title>{esc(p['title'])}</news:title>
</news:news>
</url>""")

ns = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
{chr(10).join(news_urls)}
</urlset>"""

if "--check" in sys.argv:
    import re
    norm = lambda s: re.sub(r"<lastBuildDate>.*</lastBuildDate>", "<lastBuildDate/>", s)
    ok = True
    for path, new in [(f"{REPO}/feed.xml", feed), (f"{REPO}/news-sitemap.xml", ns)]:
        try:
            old = open(path).read()
        except FileNotFoundError:
            old = None
        if old is None or norm(old) != norm(new):
            print(f"DRIFT: {path} differs from generated output — run python3 tools/build_feed.py")
            ok = False
    sys.exit(0 if ok else 1)

open(f"{REPO}/feed.xml", "w").write(feed)
open(f"{REPO}/news-sitemap.xml", "w").write(ns)
print(f"feed.xml: {min(len(posts), FEED_ITEMS)} items (summary only)")
print(f"news-sitemap.xml: {len(news_urls)} recent articles")
