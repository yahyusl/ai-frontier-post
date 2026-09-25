#!/usr/bin/env python3
"""Build podcasts/index.html from podcasts/episodes.json.

Static page listing long-form podcast/interview episodes with AI leaders,
each embedded via youtube-nocookie. Regenerated daily by the podcast desk.
Usage: python3 tools/build_podcasts.py [--check]
"""
import html
import json
import os
import sys
from datetime import datetime

REPO = "/home/hatch/workspace/ai-frontier-post"
os.chdir(REPO)

DATA = "podcasts/episodes.json"
OUT = "podcasts/index.html"

NAV = ('<nav class="mastnav" aria-label="Sections"><a href="/">Latest</a>'
       '<a href="/category/ai-news/">AI News</a><a href="/category/research/">Research</a>'
       '<a href="/category/frontier-labs/">Frontier Labs</a><a href="/category/tutorials/">Tutorials</a>'
       '<a href="/category/reviews/">Reviews</a><a href="/podcasts/" class="active">Podcasts</a>'
       '<a href="/book/">Book</a><a href="/about/">About</a></nav>')

FOOTER = '''<footer class="footer"><div class="wrap">
<div class="foot-grid">
<div class="foot-brand"><a class="wordmark" href="/">AI <em>Frontier</em> Post</a><p>Dispatches from the AI frontier — research explained, labs decoded, tools tested. Independent and reader-first.</p><a class="foot-mail" href="mailto:contact@aifrontierpost.com">contact@aifrontierpost.com</a></div>
<nav class="foot-col" aria-label="Sections"><h4>Sections</h4><a href="/category/ai-news/">AI News</a><a href="/category/research/">Research</a><a href="/category/frontier-labs/">Frontier Labs</a><a href="/category/tutorials/">Tutorials</a><a href="/category/reviews/">Reviews</a><a href="/podcasts/">Podcasts</a></nav>
<nav class="foot-col" aria-label="Publication"><h4>Publication</h4><a href="/about/">About</a><a href="/about/">Editorial standards</a><a href="/about/">Corrections policy</a><a href="/about/">Affiliate disclosure</a></nav>
<div class="foot-col"><h4>The briefing</h4><p>One sharp email a week. The research that matters, the lab moves that count, the tools worth your time.</p><a class="btn-accent" href="/#newsletter">Get the briefing</a></div>
</div>
<div class="foot-base"><span>© 2026 AI Frontier Post. All rights reserved.</span><span>Some links are affiliate links; we may earn a commission.</span><span>Sponsored stories are clearly labeled.</span></div>
</div></footer>'''

THEME_JS = '''<script>(function(){var b=document.getElementById('themeBtn');if(b)b.addEventListener('click',function(){var c=document.documentElement.dataset.theme,n=c==='dark'?'light':c==='light'?'dark':(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark');document.documentElement.dataset.theme=n;try{localStorage.setItem('afp-theme',n)}catch(e){}});})();</script>'''


def fmt_date(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%B %d, %Y")


def ep_card(ep):
    vid = html.escape(ep["video_id"], quote=True)
    title = html.escape(ep["title"])
    channel = html.escape(ep["channel"])
    desc = html.escape(ep["description"])
    dur = html.escape(ep["duration"])
    date = fmt_date(ep["published"])
    return f'''<article class="pod-ep">
<figure class="video-embed"><div class="vid-frame"><iframe src="https://www.youtube-nocookie.com/embed/{vid}" title="{title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><figcaption>{title} — {channel}</figcaption></figure>
<h3>{title}</h3>
<div class="meta">{channel} · {date} · {dur}</div>
<p>{desc}</p>
<p><a class="watch" href="https://www.youtube.com/watch?v={vid}">Watch on YouTube &rarr;</a></p>
</article>'''


def render(data):
    leaders = data["leaders"]
    eps = data.get("episodes", [])
    by_leader = {}
    for ep in eps:
        by_leader.setdefault(ep["leader"], []).append(ep)
    for v in by_leader.values():
        v.sort(key=lambda e: e["published"], reverse=True)

    sections = []
    for L in leaders:
        name = L["name"]
        affil = html.escape(L["affiliation"])
        n = html.escape(name)
        cards = "\n".join(ep_card(e) for e in by_leader.get(name, []))
        if not cards:
            cards = ('<p class="pod-none">No new long-form appearances in the last '
                     f'{data.get("window_days", 14)} days. This page refreshes daily — check back soon.</p>')
        sections.append(f'<section class="pod-leader">\n<h2>{n} <span class="affil">{affil}</span></h2>\n{cards}\n</section>')
    body = "\n".join(sections)
    updated = fmt_date(data["updated"])
    window = data.get("window_days", 14)
    desc = ("Long-form podcast interviews and conversations with the people building frontier AI — "
            "Sam Altman, Dario Amodei, Jensen Huang, Geoffrey Hinton, Yoshua Bengio, Yann LeCun, "
            "and Demis Hassabis. Original episodes only, 10 minutes or longer, refreshed daily.")

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/assets/favicon.png">
<title>AI Leader Podcasts — AI Frontier Post</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="https://aifrontierpost.com/podcasts/">
<meta property="og:title" content="AI Leader Podcasts — AI Frontier Post">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://aifrontierpost.com/podcasts/">
<meta property="og:site_name" content="AI Frontier Post">
<meta property="og:image" content="https://aifrontierpost.com/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{{"@context": "https://schema.org", "@type": "CollectionPage", "name": "AI Leader Podcasts — AI Frontier Post", "description": "{html.escape(desc)}", "url": "https://aifrontierpost.com/podcasts/"}}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,560;0,9..144,680;0,9..144,760;1,9..144,560;1,9..144,680&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script>try{{var __t=localStorage.getItem('afp-theme');if(__t)document.documentElement.dataset.theme=__t;}}catch(e){{}}</script>
</head>
<body>
<header class="masthead"><div class="wrap masthead-in">
<a class="wordmark" href="/">AI <em>Frontier</em> Post</a>
{NAV}
<div class="mast-actions"><button class="icon-btn" id="themeBtn" aria-label="Toggle color theme"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9 6 6 0 0 1-9-9Z"/></svg></button><a class="btn-brief" href="/#newsletter"><span>Get the&nbsp;</span>Briefing</a></div>
</div></header>
<main><div class="wrap">
<nav class="crumb"><a href="/">Home</a> / Podcasts</nav>
<header class="page-head"><span class="chip">Curated</span>
<h1>AI Leader Podcasts</h1>
<p class="lede">{html.escape(desc)} Currently showing episodes from the last {window} days.</p>
<p class="pod-updated">Updated {updated} · videos play here or on YouTube · only original uploads from the show's own channel</p>
</header>
{body}
</div></main>
{FOOTER}
{THEME_JS}
</body>
</html>
'''


def main():
    data = json.load(open(DATA))
    # sanity: video ids look like 11-char YouTube ids
    for ep in data.get("episodes", []):
        vid = ep.get("video_id", "")
        assert len(vid) == 11, f"bad video_id: {vid!r}"
    new_html = render(data)
    if "--check" in sys.argv:
        old = open(OUT).read() if os.path.exists(OUT) else ""
        if old != new_html:
            print(f"{OUT} is stale — run tools/build_podcasts.py")
            sys.exit(1)
        print("podcasts page fresh")
        return
    os.makedirs("podcasts", exist_ok=True)
    open(OUT, "w").write(new_html)
    print(f"wrote {OUT} ({len(data.get('episodes', []))} episodes)")


if __name__ == "__main__":
    main()
