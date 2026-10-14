#!/usr/bin/env python3
"""Repair article pages that shipped broken.

Three defects the desk pipelines have produced:

1. Bare body content straight after the masthead: no <main>/.wrap container,
   no <h1>, no byline, no .article-body. These are wrapped in the standard
   template (crumb, post-header, hero-art, article-body, related), taking
   title/author/date/category/reading time from posts.json.
2. A <head> that stops after the JSON-LD block: no fonts, no site.css, no
   theme boot, no </head> -- the page renders as unstyled HTML. The standard
   head assets are restored.
3. A page truncated mid-article: no closing tags, no footer. Open containers
   are closed and the standard footer appended.
4. Tag closers emitted as the literal text "...placeholder..." (e.g.
   `<div class="wrap"...placeholder...`), which swallows the next element.
5. A post-header with the body copy loose inside <article> (no .article-body,
   so no article typography or reading measure), sometimes with the hero image
   stranded above <main>. The copy is wrapped and the hero moved under the header.
6. Doubled tag closers in <head> (`content="...">>`); the stray ">" render as
   text at the top of the page.
7. A mangled theme-toggle script (e.g. `c==='light':'dark'`, a syntax error)
   that leaves the dark-mode button dead. Replaced with the standard one.

Every page also gets /assets/site.js and the theme-toggle script if missing.
Idempotent: healthy pages are left untouched.
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

FONTS = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,560;0,9..144,680;"
         "0,9..144,760;1,9..144,560;1,9..144,680&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600;700&display=swap")
HEAD_ASSETS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    f'<link href="{FONTS}" rel="stylesheet">\n'
    '<link rel="stylesheet" href="/assets/site.css">\n'
    "<script>try{var __t=localStorage.getItem('afp-theme');if(__t)document.documentElement.dataset.theme=__t;}catch(e){}</script>\n"
)
SITE_JS = '<script src="/assets/site.js" defer></script>\n'
THEME_TOGGLE = ("<script>(function(){var b=document.getElementById('themeBtn');if(b)b.addEventListener('click',function(){"
                "var c=document.documentElement.dataset.theme,n=c==='dark'?'light':c==='light'?'dark':(window.matchMedia&&"
                "matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark');document.documentElement.dataset.theme=n;"
                "try{localStorage.setItem('afp-theme',n)}catch(e){}});})();</script>\n")
TOGGLE_RE = re.compile(r"<script>\(function\(\)\{var b=document\.getElementById\('themeBtn'\).*?</script>\n?", re.S)
FOOTER = """<footer class="footer"><div class="wrap">
<div class="foot-grid">
<div class="foot-brand"><a class="wordmark" href="/">AI <em>Frontier</em> Post</a><p>Dispatches from the AI frontier — research explained, labs decoded, tools tested. Independent and reader-first.</p><a class="foot-mail" href="mailto:contact@aifrontierpost.com">contact@aifrontierpost.com</a></div>
<nav class="foot-col" aria-label="Sections"><h4>Sections</h4><a href="/category/ai-news/">AI News</a><a href="/category/research/">Research</a><a href="/category/frontier-labs/">Frontier Labs</a><a href="/category/tutorials/">Tutorials</a><a href="/category/reviews/">Reviews</a><a href="/podcasts/">Podcasts</a></nav>
<nav class="foot-col" aria-label="Publication"><h4>Publication</h4><a href="/about/">About</a><a href="/about/">Editorial standards</a><a href="/about/">Corrections policy</a><a href="/about/">Affiliate disclosure</a></nav>
<div class="foot-col"><h4>The briefing</h4><p>One sharp email a week. The research that matters, the lab moves that count, the tools worth your time.</p><a class="btn-accent" href="/#newsletter">Get the briefing</a></div>
</div>
<div class="foot-base"><span>© 2026 AI Frontier Post. All rights reserved.</span><span>Some links are affiliate links; we may earn a commission.</span><span>Sponsored stories are clearly labeled.</span></div>
</div></footer>
"""


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


def unclosed(fragment):
    """Container tags still open at the end of the fragment, innermost last."""
    stack = []
    for m in re.finditer(r"<(/?)(%s)\b[^>]*>" % "|".join(CONTAINERS), fragment):
        if not m.group(1):
            stack.append(m.group(2))
        elif m.group(2) in stack:
            while stack and stack.pop() != m.group(2):
                pass
    return stack


def repair_frame(html):
    """Restore missing head assets, closing tags, footer, site.js and theme toggle."""
    out = re.sub(r"(<[a-zA-Z][^<>]*?)\.\.\.placeholder\.\.\.(?=\n)", r"\1>", html)
    b = out.find("<body")
    if b > 0:
        head = re.sub(r'(<(?:meta|link)\b[^<>]*"\s*/?)>>+(?=\s*\n)', r"\1>", out[:b])
        out = re.sub(r"(?m)^[ \t]*>[ \t]*\n", "", head) + out[b:]
    if "/assets/site.css" not in out:
        if "</head>" in out:
            out = out.replace("</head>", HEAD_ASSETS + "</head>", 1)
        elif "<body" in out:
            i = out.index("<body")
            out = out[:i] + HEAD_ASSETS + "</head>\n" + out[i:]
    if "/assets/site.js" not in out and "</head>" in out:
        out = out.replace("</head>", SITE_JS + "</head>", 1)
    if '<footer class="footer">' not in out and "<body" in out:
        body = out[out.index("<body"):]
        tail = "".join(f"</{t}>" for t in reversed(unclosed(body)))
        out = out.rstrip() + "\n" + (tail + "\n" if tail else "") + FOOTER
        if "</body>" not in out:
            out += "</body>\n</html>\n"
    toggles = TOGGLE_RE.findall(out)
    if toggles and (len(toggles) > 1 or toggles[0].strip() != THEME_TOGGLE.strip()):
        out = TOGGLE_RE.sub("", out)
    if 'id="themeBtn"' in out and "getElementById('themeBtn')" not in out:
        out = out.replace("</body>", THEME_TOGGLE + "</body>", 1) if "</body>" in out else out + THEME_TOGGLE
    if "</body>" not in out:
        out = out.rstrip() + "\n</body>\n</html>\n"
    return None if out == html else out


def element_end(html, i, tag):
    """Index just past the element of type `tag` that opens at html[i]; -1 if unbalanced."""
    depth = 0
    for m in re.finditer(r"<(/?)%s\b[^>]*>" % tag, html[i:]):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return i + m.end()
    return -1


def byline_html(slug, roles):
    p = posts[slug]
    author = p["author"]
    meta = f"{esc(roles.get(author, 'Contributor'))} · {long_date(p['date'])} · {p['reading_minutes']} min read"
    return (f'<div class="byline"><span class="avatar">{"".join(w[0] for w in author.split())}</span>'
            f'<span class="who"><b>{esc(author)}</b><span>{meta}</span></span></div>')


def wrap_loose_body(html, slug=None, roles=None):
    """Wrap copy that sits directly in <article class="post"> in .article-body.

    Some pages never close the post-header either (the copy then lives inside
    <header>); it is closed after the byline. Pages whose structure can't be
    read with confidence are left untouched."""
    if 'class="post-header"' not in html or 'class="article-body"' in html:
        return html
    main = html.find("<main")
    hero = re.search(r'<figure class="hero-art">.*?</figure>\s*', html, re.S)
    if hero and main >= 0 and hero.start() < main:
        html = html[:hero.start()] + html[hero.end():]
        main = html.find("<main")
    else:
        hero = None
    ph = html.find('<header class="post-header"')
    if ph < 0 or ph < main:
        return html
    close = element_end(html, ph, "header")
    art_end = html.find("</article>", ph)
    if close < 0 or (art_end >= 0 and close > art_end):
        # unterminated post-header: end it after the byline (or the lede / headline,
        # adding the standard byline when the page has none)
        cut, extra = -1, ""
        for marker, tag in (('<div class="byline"', "div"), ('<p class="byline"', "p"), ('<p class="lede"', "p"), ("<h1", "h1")):
            i = html.find(marker, ph)
            if i >= 0 and (art_end < 0 or i < art_end):
                cut = element_end(html, i, tag)
                if "byline" not in marker and slug in posts:
                    extra = "\n" + byline_html(slug, roles or {})
                break
        if cut < 0:
            return html
        ins = extra + "\n</header>"
        html = html[:cut] + ins + html[cut:]
        start = cut + len(ins)
    else:
        start = close
    if hero:
        fig = "\n" + hero.group(0).strip()
        html = html[:start] + fig + html[start:]
        start += len(fig)
    m = re.match(r'\s*<figure class="hero-art">.*?</figure>', html[start:], re.S)
    if m:
        start += m.end()
    ends = [i for i in (html.find("</article>", start), html.find('<div class="post-engage"', start),
                        html.find('<section class="related"', start), html.find('<footer', start)) if i >= 0]
    if not ends:
        return html
    end = min(ends)
    body = html[start:end].strip()
    if not body or start <= ph:
        return html
    return html[:start] + '\n<div class="article-body">' + body + "</div>\n" + html[end:]


def repair(slug, html, roles):
    if 'class="post-header"' in html:
        out = wrap_loose_body(html, slug, roles)
        return repair_frame(out) or (out if out != html else None)
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
    out = html[:head_end] + shell + html[foot:]
    return repair_frame(out) or out


def main():
    check = "--check" in sys.argv
    roles = author_roles()
    broken = []
    for slug in sorted(posts):
        path = f"articles/{slug}/index.html"
        if not os.path.exists(path):
            continue
        html = open(path).read()
        out, cur = None, html
        for _ in range(4):  # some fixes unlock others (e.g. closing a truncated page lets its body be wrapped)
            nxt = repair(slug, cur, roles)
            if nxt is None or nxt == cur:
                break
            out = cur = nxt
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
