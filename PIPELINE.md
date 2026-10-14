# AI Frontier Post — pipeline notes

How the homepage is assembled (all logic lives in `index.html`; styles in `assets/site.css`).

## Homepage data (`posts.json`)

The homepage is a thin shell: it fetches `posts.json` (slim index — title, slug,
thumbnail path, category, excerpt, tags, author, date, reading_minutes, sponsored)
and renders from it. Article bodies and images are NOT inlined (the 8 MB homepage
era ended 2026-09-24: bodies live in `articles/<slug>/index.html`, covers in
`articles/<slug>/cover.webp` referenced by path — never base64).
When publishing, prepend the slim entry to `posts.json`, then run
`python3 tools/build_feed.py` and `python3 tools/check_consistency.py`.
Legacy `#post/`, `#category/`, `#about` hash routes 301-style redirect to the
static URLs (`/articles/<slug>/`, `/category/<name>/`, `/about/`).

## Homepage order

1. **Frontier models scoreboard** — dark sports-ticker strip directly under the masthead,
   built by `scoreStrip()` from the `BENCHMARKS` array (six leagues, top-3 compact,
   "Full standings" expands the rest, `?` shows the methodology explainer).
   Benchmark numbers must be re-checked against the primary leaderboards before every
   update — no automatic sync exists. Last source-sync: 2026-09-22.
2. **Top stories of the day** — hero lead + 3-card side stack, chosen by `topPicks()`.
3. **The latest** — remaining articles newest-first (picks excluded, no duplicates), 12 at a time
   with a "More stories" button (`PAGE` in `index.html`) — never render the whole archive at once.
4. **Trending** sidebar — follows the picks order, then newest.

## Editing the top stories

`topPicks()` uses the `TOP_PICKS` array — four article slugs in editorial order
(currently: `claude-opus-5-5-launch`, `desantis-ai-bubble-crash-bailout-warning`,
`openai-gpt-6-sol-luna-launch`, `nscale-ipo-filing-neocloud-public-market`).
When a new story publishes that deserves the spotlight, edit `TOP_PICKS` to feature it —
prefer same-day stories for "top stories of the day". If `TOP_PICKS` is left stale,
`viewScore()` ranks by a heuristic (recency, major-lab names, launches, money/IPO
signals, policy, public figures) as a fallback; missing slugs are skipped silently.

## Article images

Standing rule (Yahya, 2026-09-24): every article ships with 2–3 images — the
hero cover plus 1–2 inline images in the body. Per image, always look for a FREE
PUBLIC image of the subject first (official/lab/event photos, portraits,
public-domain or CC images); only generate an AI image with
`media.generate_image` if no suitable free image exists.

Inline images: `articles/<slug>/img2.webp`, `img3.webp` (16:9 webp, ~<50KB),
placed as `<figure class="inline-art"><img class="story-image" src="/articles/<slug>/img2.webp" alt="..."><figcaption><credit></figcaption></figure>`
at natural body breaks (never mid-paragraph).

Every image carries a `<figcaption>` credit line — the site CSS
(`assets/site.css`) hides figcaptions visually (screen-reader-only) while keeping
them in the DOM for accessibility/licensing.

Generate catchy cover images only for articles visible on the homepage (hero + top
stories), max ~10 at a time — keep the article selection deliberate.

## Category pages

`category/<slug>/index.html` are generated from posts.json by `python3 tools/build_category_pages.py`
(`--check` reports stale pages). Their masthead is a `<div class="masthead" role="banner">`, so the
first `</header>` on the page is the archive's own page-head: the desks' "insert the new story after
the first `</header>`" step then lands at the top of the list instead of above `<main>` (that bug had
put 310 AI News stories above the page title and erased Tutorials' `<main>`). Keep the count copy
formats — "All N <Cat> stories" and "(N stories)" — the pipelines and the CI check rewrite/read them.
With JavaScript, `assets/site.js` replaces the static list with the interactive archive (search,
topic filters, sort, month groups, load more) rendered from posts.json; the static list stays for
crawlers and no-JS readers.

## Article page shell

Every `articles/<slug>/index.html` must use the standard shell: `<main><div class="wrap">` →
crumb → `<article class="post">` with `<header class="post-header">` (chip, `<h1>`, lede, byline) →
`figure.hero-art` → `div.article-body`. Pages emitted as bare body content render edge to edge
with no headline; `python3 tools/repair_article_shell.py` re-wraps them from `posts.json`
(`--check` lists any that need it). It also repairs the other defects the desks have emitted:
a `<head>` cut off after the JSON-LD (no stylesheet — 172 pages rendered unstyled), pages
truncated mid-article (no footer), copy left loose in `<article>` (no `.article-body`), unclosed
post-headers, `...placeholder...` in place of tag closers, doubled `>>` in the head, and mangled
theme-toggle scripts (215 pages had a dead dark-mode button). Every page also gets `site.js`.

## Site behaviour (assets/site.js)

Reading progress, back-to-top ring, scroll reveal, card spotlight, a contents rail on wide
screens (articles with 3+ sections), drop caps, scoreboard count-up, cross-page view transitions.
All motion is skipped under prefers-reduced-motion. Easter eggs, for the curious: `?` shortcuts
panel, `/` search, `j`/`k`, `g`+letter navigation, Konami code (tokenizer vision), typing `agi`,
seven quick clicks on the theme button (terminal mode), five clicks on the homepage wordmark,
the console greeting, and the 404 page.

## Deploy

Cloudflare Pages auto-deploys from `git push` (live within ~1 min).
Verify at https://aifrontierpost.com on desktop, ~820px tablet and 390px phone width after changes.
