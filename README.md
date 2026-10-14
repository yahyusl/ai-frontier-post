# AI Frontier Post

AI news, research explainers, frontier lab coverage, and product comparisons — https://aifrontierpost.com

Static site. `index.html` is the homepage shell (143 articles indexed in `posts.json`), deployed to Cloudflare Pages.
`_redirects` holds the redirect rules. `robots.txt` is served at the site root.

Deploys: push to `main` (or connect Cloudflare Pages to this repo for auto-deploys).

Generators live in `tools/`: `build_feed.py` (feed.xml + news-sitemap.xml from posts.json)
`check_consistency.py` (CI drift check: posts.json, category pages, sitemap, feeds),
`build_category_pages.py` (the five category archives from posts.json),
and `repair_article_shell.py` (repairs article pages the desks publish broken; `--check` audits).
Publishing runbook: `~/workspace/ai-news-pipeline/PIPELINE.md`.
