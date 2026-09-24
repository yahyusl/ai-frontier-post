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
3. **The latest** — remaining articles newest-first (picks excluded, no duplicates).
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

## Deploy

Cloudflare Pages auto-deploys from `git push` (live within ~1 min).
Verify at https://aifrontierpost.com on desktop and 390px phone width after changes.
