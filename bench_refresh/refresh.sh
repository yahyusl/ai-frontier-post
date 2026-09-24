#!/bin/bash
# Daily benchmark refresh: fetch fresh numbers, rebuild the scoreboard block,
# validate, commit, and push. Any failure aborts BEFORE touching index.html
# (fetch/build) or before pushing (validate/commit), so the live site is
# never left with partial or invalid data.
set -euo pipefail
cd "$(dirname "$0")/.."

# Never sweep someone else's uncommitted work into the benchmark commit.
# (benchmarks.json is a pure pipeline artifact: reset any leftover from an
# aborted run, then guard the real sources.)
git checkout -q -- bench_refresh/benchmarks.json 2>/dev/null || true
if [ -n "$(git status --porcelain -- index.html bench_refresh/fetch_benchmarks.py bench_refresh/build.py bench_refresh/meta.json bench_refresh/refresh.sh)" ]; then
  echo "bench files have uncommitted changes; aborting" >&2
  exit 1
fi

echo "== fetching =="
python3 bench_refresh/fetch_benchmarks.py

echo "== building =="
# Unique temp files so two concurrent runs never clash on fixed /tmp paths.
# Cleaned up on any exit (success or abort) via the trap below.
BENCH_BAK=$(mktemp /tmp/index.html.bench-bak.XXXXXX)
INLINE_JS=$(mktemp /tmp/inline.js.XXXXXX)
trap 'rm -f "$BENCH_BAK" "$INLINE_JS"' EXIT
export BENCH_BAK INLINE_JS
cp index.html "$BENCH_BAK"
python3 bench_refresh/build.py

echo "== validating =="
python3 - <<'EOF'
import os, re
html = open('index.html').read()
scripts = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', html, re.S)
open(os.environ['INLINE_JS'],'w').write('\n;\n'.join(scripts))
EOF
node --check "$INLINE_JS"
python3 - <<'EOF'
import os, re
html = open('index.html').read()
before = open(os.environ['BENCH_BAK']).read()
for name in ['scoreStrip','scoreCard','scoreRows','bfmt','bbar']:
    a = len(re.findall(r'function %s\(' % name, before))
    b = len(re.findall(r'function %s\(' % name, html))
    assert a == b == 1, f'function inventory changed for {name}: {a} -> {b}'
ids = re.findall(r'\{id:"([a-z]+)"', html.split('/*__BENCH_DATA__*/')[1].split('/*__BENCH_END__*/')[0])
assert ids == ['aa','tb','fc','ab','tbs','hle'], f'unexpected benchmark ids: {ids}'
print('inventory OK:', ids)
EOF

echo "== committing =="
git add index.html bench_refresh/benchmarks.json
STAMP=$(date +%F)
if git diff --cached --quiet; then
  echo "no changes"
else
  git commit -m "Benchmarks: daily refresh ${STAMP}" -q
  git fetch -q origin
  BEHIND=$(git rev-list --count HEAD..origin/main)
  if [ "${BEHIND}" -gt 0 ]; then
    if [ -n "$(git status --porcelain)" ]; then
      echo "origin moved but tree is dirty; leaving commit unpushed" >&2
      exit 1
    fi
    git rebase -q origin/main
  fi
  git push -q origin main
  echo "pushed"
fi
