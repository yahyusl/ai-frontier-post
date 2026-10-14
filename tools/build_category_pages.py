#!/usr/bin/env python3
"""Rebuild the five category archive pages from posts.json.

The desk pipelines publish by inserting a story right after the first
`</header>` in a category page. When that first header was the site
masthead, stories piled up above <main>, outside the page container
(AI News had 310 stories above its own title; Tutorials lost its <main>
entirely). These pages therefore render the masthead as
<div class="masthead" role="banner">, so the first `</header>` is the
archive's own page-head and inserted stories land at the top of the list.

Count copy keeps the formats the pipelines and check_consistency.py rely
on: "All N <Cat> stories" in the meta description and "(N stories)".

Usage: python3 tools/build_category_pages.py [--check]
"""
import html, json, os, sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO)

CATS = [
    ("AI News", "ai-news", "Breaking developments and analysis from the AI industry."),
    ("Research", "research", "Plain-English explainers of machine-learning papers and findings."),
    ("Frontier Labs", "frontier-labs", "What the leading AI labs are shipping and building."),
    ("Tutorials", "tutorials", "Step-by-step guides for building with AI."),
    ("Reviews", "reviews", "Hands-on, stress-tested reviews of AI tools."),
]
NAV = [("Latest", "/"), ("AI News", "/category/ai-news/"), ("Research", "/category/research/"),
       ("Frontier Labs", "/category/frontier-labs/"), ("Tutorials", "/category/tutorials/"),
       ("Reviews", "/category/reviews/"), ("Podcasts", "/podcasts/"), ("Book", "/book/"), ("About", "/about/")]
FONTS = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,560;0,9..144,680;"
         "0,9..144,760;1,9..144,560;1,9..144,680&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap")
THEME_BOOT = "<script>try{var __t=localStorage.getItem('afp-theme');if(__t)document.documentElement.dataset.theme=__t;}catch(e){}</script>"
THEME_TOGGLE = ("<script>(function(){var b=document.getElementById('themeBtn');if(b)b.addEventListener('click',function(){"
                "var c=document.documentElement.dataset.theme,n=c==='dark'?'light':c==='light'?'dark':(window.matchMedia&&"
                "matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark');document.documentElement.dataset.theme=n;"
                "try{localStorage.setItem('afp-theme',n)}catch(e){}});})();</script>")
MOON = ('<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9 6 6 0 0 1-9-9Z"/></svg>')


def esc(s):
    # posts.json is mostly raw text but a few fields carry entities (&#x27;): decode, then escape once
    return html.escape(html.unescape(str(s)), quote=True)


def long_date(d):
    dt = datetime.strptime(d, "%Y-%m-%d")
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


def card(p, slug_cls):
    url = f"/articles/{p['slug']}/"
    thumb = (f'<a class="art-thumb" href="{url}" tabindex="-1" aria-hidden="true">'
             f'<img src="{esc(p["thumbnail"])}" alt="" loading="lazy" decoding="async"></a>') if p.get("thumbnail") else ""
    sponsored = '<span class="sponsored-badge">Sponsored</span>' if p.get("sponsored") else ""
    return (f'<div class="art-item">{thumb}<span class="chip {slug_cls}">{esc(p["category"])}</span>{sponsored}'
            f'<h2><a href="{url}">{esc(p["title"])}</a></h2><p>{esc(p["excerpt"])}</p>'
            f'<div class="meta">{esc(p["author"])} · {long_date(p["date"])} · {p["reading_minutes"]} min read</div></div>')


def page(name, slug, desc, posts):
    n = len(posts)
    title = f"{name} — AI Frontier Post"
    meta = f"{desc} All {n} {name} stories on AI Frontier Post."
    url = f"https://aifrontierpost.com/category/{slug}/"
    nav = "".join(f'<a href="{h}"{" class=\"active\" aria-current=\"page\"" if h.endswith(f"/{slug}/") else ""}>{t}</a>' for t, h in NAV)
    items = "\n".join(card(p, slug) for p in posts)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="/assets/favicon.png">
<title>{esc(title)}</title>
<meta name="description" content="{esc(meta)}">
<link rel="canonical" href="{url}">
<link rel="alternate" type="application/rss+xml" title="AI Frontier Post" href="/feed.xml">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(meta)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:image" content="https://aifrontierpost.com/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
{THEME_BOOT}
<script src="/assets/site.js" defer></script>
</head>
<body class="cat-page" data-category="{esc(name)}" data-cat-slug="{slug}">
<div class="masthead" role="banner"><div class="wrap masthead-in">
<a class="wordmark" href="/" aria-label="AI Frontier Post home">AI <em>Frontier</em> Post</a>
<nav class="mastnav" aria-label="Sections">{nav}</nav>
<div class="mast-actions"><button class="icon-btn" id="themeBtn" aria-label="Toggle color theme">{MOON}</button><a class="btn-brief" href="/#newsletter"><span>Get the&nbsp;</span>Briefing</a></div>
</div></div>
<main><div class="wrap cat-head">
<nav class="crumb"><a href="/">Home</a> / {esc(name)}</nav>
<header class="page-head"><span class="chip {slug}">Archive</span>
<h1>{esc(name)}</h1>
<p class="cat-desc">{esc(desc)} ({n} stories)</p>
</header>
{items}
</div></main>
<footer class="footer"><div class="wrap">
<div class="foot-grid">
<div class="foot-brand"><a class="wordmark" href="/">AI <em>Frontier</em> Post</a><p>Dispatches from the AI frontier — research explained, labs decoded, tools tested. Independent and reader-first.</p><a class="foot-mail" href="mailto:contact@aifrontierpost.com">contact@aifrontierpost.com</a></div>
<nav class="foot-col" aria-label="Sections"><h4>Sections</h4><a href="/category/ai-news/">AI News</a><a href="/category/research/">Research</a><a href="/category/frontier-labs/">Frontier Labs</a><a href="/category/tutorials/">Tutorials</a><a href="/category/reviews/">Reviews</a><a href="/podcasts/">Podcasts</a></nav>
<nav class="foot-col" aria-label="Publication"><h4>Publication</h4><a href="/about/">About</a><a href="/about/">Editorial standards</a><a href="/about/">Corrections policy</a><a href="/about/">Affiliate disclosure</a></nav>
<div class="foot-col"><h4>The briefing</h4><p>One sharp email a week. The research that matters, the lab moves that count, the tools worth your time.</p><a class="btn-accent" href="/#newsletter">Get the briefing</a></div>
</div>
<div class="foot-base"><span>© 2026 AI Frontier Post. All rights reserved.</span><span>Some links are affiliate links; we may earn a commission.</span><span>Sponsored stories are clearly labeled.</span></div>
</div></footer>
{THEME_TOGGLE}
</body>
</html>
"""


def main():
    check = "--check" in sys.argv
    posts = sorted(json.load(open("posts.json")), key=lambda p: p["date"], reverse=True)
    stale = []
    for name, slug, desc in CATS:
        out = page(name, slug, desc, [p for p in posts if p["category"] == name])
        path = f"category/{slug}/index.html"
        cur = open(path).read() if os.path.exists(path) else ""
        if cur != out:
            stale.append(path)
            if not check:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "w").write(out)
    print(("stale: " if check else "wrote: ") + (", ".join(stale) or "none"))
    if check and stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
