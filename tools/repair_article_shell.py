#!/usr/bin/env python3
"""Repair article pages that shipped without the article shell.

Some tutorial-desk pages were written as bare body content straight after the
masthead: no <main>/.wrap container, no <h1>, no byline, no .article-body. They
render edge to edge, overflow sideways on phones and have no headline.

This wraps such pages in the standard template used by every other article
(crumb, post-header with chip/h1/lede/byline, hero-art, article-body, related),
taking title/author/date/category/reading time from posts.json.

Idempotent: pages that already have a .post-header are left untouched.
Usage: python3 tools/repair_article_shell.py [--check]
"""
import json, os, re, sys
from collections import Counter, defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO)

CATS = {"AI News": "ai-news", "Research": "research", "Frontier Labs": "frontier-labs",
        "Tutorials": "tutorials", "Reviews": "reviews"}

posts = {p["slug"]: p for p in json.load(open("posts.json"))}


def author_roles():
    """Most common byline role per author, read from healthy article pages."""
    seen = defaultdict(Counter)
    for slug in posts:
        try:
            h = open(f"articles/{slug}/index.html").read()
        except OSError:
            continue
        m = re.search(r'<span class="who"><b>([^<]+)</b><span>([^<·&]+?)\s*(?:·|&middot;)', h)
        if m:
            seen[m.group(1).strip()][m.group(2).strip().replace("&amp;", "&")] += 1
    return {a: c.most_common(1)[0][0] for a, c in seen.items()}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def long_date(d):
    dt = datetime.strptime(d, "%Y-%m-%d")
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


CONTAINERS = ("div", "section", "article", "main")


def drop_unmatched_closers(fragment):
    """Remove container closing tags that have no matching opener in the fragment."""
    out, stack, pos = [], [], 0
    for m in re.finditer(r"<(/?)(%s)\b[^>]*>" % "|".join(CONTAINERS), fragment):
        closing, tag = m.group(1) == "/", m.group(2)
        out.append(fragment[pos:m.start()])
        pos = m.end()
        if not closing:
            stack.append(tag)
            out.append(m.group(0))
        elif tag in stack:
            while stack and stack[-1] != tag:
                stack.pop()
            stack.pop()
            out.append(m.group(0))
        # else: stray closer from the generator — drop it
    out.append(fragment[pos:])
    return "".join(out)


def repair(slug, html, roles):
    if 'class="post-header"' in html:
        return None
    p = posts[slug]
    head_end = html.find("</header>") + len("</header>")
    foot = html.find('<footer class="footer">')
    if head_end < len("</header>") or foot < 0:
        return None
    body = html[head_end:foot].strip()
    # stray closers left over from the generator
    body = re.sub(r"(?:</div>\s*)?</main>\s*$", "", body).strip()

    # hero: keep this article's own cover; drop covers that belong to another article
    hero = ""
    while True:
        m = re.match(r'<figure class="hero-art">.*?</figure>\s*', body, re.S)
        if not m:
            break
        fig = m.group(0).strip()
        if not hero and f"/articles/{slug}/" in fig:
            hero = fig
        body = body[m.end():]

    lede = ""
    m = re.match(r'<p class="lede">.*?</p>\s*', body, re.S)
    if m:
        lede = m.group(0).strip()
        body = body[m.end():]

    tail = ""
    for marker in ('<div class="post-engage">', '<section class="related">', "<h2>Related articles</h2>"):
        i = body.find(marker)
        if i >= 0:
            tail = body[i:]
            body = body[:i]
            break
    body = drop_unmatched_closers(body)
    if "<h2>Related articles</h2>" in tail and '<section class="related">' not in tail:
        tail = tail.replace("<h2>Related articles</h2>", '<section class="related"><h2>Related articles</h2>', 1)
    tail = drop_unmatched_closers(tail)
    tail = re.sub(r'<span class="chip">([^<]+)</span>',
                  lambda m: f'<span class="chip {CATS[m.group(1)]}">{m.group(1)}</span>' if m.group(1) in CATS else m.group(0),
                  tail)

    cat = p["category"]
    author = p["author"]
    initials = "".join(w[0] for w in author.split())
    role = roles.get(author, "Contributor")
    meta = f"{esc(role)} · {long_date(p['date'])} · {p['reading_minutes']} min read"
    shell = (
        "\n<main><div class=\"wrap\">\n"
        f'<nav class="crumb"><a href="/">Home</a> / <a href="/category/{CATS[cat]}/">{esc(cat)}</a></nav>\n'
        '<article class="post">\n<header class="post-header">\n'
        f'<div class="chip-row"><span class="chip {CATS[cat]}">{esc(cat)}</span></div>\n'
        f"<h1>{esc(p['title'])}</h1>\n"
        + (lede + "\n" if lede else "")
        + f'<div class="byline"><span class="avatar">{initials}</span><span class="who"><b>{esc(author)}</b><span>{meta}</span></span></div>\n'
        "</header>\n"
        + (hero + "\n" if hero else "")
        + f'<div class="article-body">{body.strip()}</div>\n</article>\n'
        + (tail.strip() + "\n" if tail.strip() else "")
        + "</div></main>\n"
    )
    return html[:head_end] + shell + html[foot:]


def main():
    check = "--check" in sys.argv
    roles = author_roles()
    broken = []
    for slug in sorted(posts):
        path = f"articles/{slug}/index.html"
        if not os.path.exists(path):
            continue
        html = open(path).read()
        out = repair(slug, html, roles)
        if out is None:
            continue
        broken.append(slug)
        if not check:
            open(path, "w").write(out)
    verb = "need repair" if check else "repaired"
    print(f"{len(broken)} article page(s) {verb}" + (": " + ", ".join(broken) if broken and check else ""))
    if check and broken:
        sys.exit(1)


if __name__ == "__main__":
    main()
