#!/usr/bin/env python3
"""Rebuild the `const BENCHMARKS=[...]` block in index.html.

Reads bench_refresh/meta.json (static copy) + bench_refresh/benchmarks.json
(fresh rows), emits the minified JS array, and splices it between the
/*__BENCH_DATA__*/ and /*__BENCH_END__*/ markers in index.html.

Usage: python3 bench_refresh/build.py   (run from repo root)
"""
import json
import re
import sys
from datetime import datetime


def js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def main():
    meta = json.load(open("bench_refresh/meta.json"))
    data = json.load(open("bench_refresh/benchmarks.json"))
    updated = datetime.strptime(data["fetched_at"][:10], "%Y-%m-%d").strftime("%b %d, %Y").replace(" 0", " ")
    # "%b %d" gives "Sep 23" already (no zero-pad with %d? %d is zero-padded). normalize:
    updated = re.sub(r" (\d),", r" \1,", datetime.strptime(data["fetched_at"][:10], "%Y-%m-%d").strftime("%b %d, %Y"))

    entries = []
    for bid in meta["order"]:
        m = meta["benchmarks"][bid]
        rows = data["benchmarks"][bid]["rows"]
        rows_js = ",".join(f"[{js(r[0])},{js(r[1])},{r[2]}]" for r in rows)
        entry = (
            "{id:" + js(m["id"]) + ",tab:" + js(m["tab"]) + ",name:" + js(m["name"])
            + ",tag:" + js(m["tag"]) + ",unit:" + js(m["unit"])
            + ",what:" + js(m["what"]) + ",example:" + js(m["example"])
            + ",note:" + js(m["note"])
            + ",source:[" + js(m["source"][0]) + "," + js(m["source"][1]) + "]"
            + ",updated:" + js(updated)
            + ",rows:[" + rows_js + "]}"
        )
        entries.append(entry)

    block = "/*__BENCH_DATA__*/" + ",".join(entries) + "/*__BENCH_END__*/"

    html = open("index.html").read()
    pat = re.compile(r"/\*__BENCH_DATA__\*/.*?/\*__BENCH_END__\*/", re.S)
    if not pat.search(html):
        sys.exit("markers /*__BENCH_DATA__*/ … /*__BENCH_END__*/ not found in index.html")
    html = pat.sub(lambda _: block, html)
    open("index.html", "w").write(html)
    print(f"patched index.html with {len(entries)} benchmarks, updated {updated}")


if __name__ == "__main__":
    sys.exit(main())
