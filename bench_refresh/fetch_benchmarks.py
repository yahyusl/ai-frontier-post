#!/usr/bin/env python3
"""Fetch current top-10 rows for the six scoreboard benchmarks.

All sources are no-auth. Each fetcher returns a list of
(model_name, org, score) with scores as floats, best-per-model, top 10.
On any failure the fetcher raises; the refresh aborts without touching
index.html (never publish stale or partial numbers silently).
"""
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


def _with_retries(fn, tries=4):
    last = None
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - transient network flakes
            last = e
            time.sleep(2 * (i + 1))
    raise last


def http_get(url, timeout=30):
    def _do():
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()

    return _with_retries(_do)


def http_post_json(url, payload, timeout=30):
    def _do():
        # curl: urllib's chunked reader flakes on this endpoint, curl is solid
        out = subprocess.run(
            ["curl", "-s", "-m", str(timeout), "-X", "POST", url,
             "-H", "Content-Type: application/json",
             "-H", "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
             "-d", json.dumps(payload)],
            capture_output=True, text=True, timeout=timeout + 10,
        )
        if out.returncode != 0:
            raise RuntimeError(f"curl POST failed rc={out.returncode}: {out.stderr[:200]}")
        return json.loads(out.stdout)

    return _with_retries(_do)


# ---------------------------------------------------------------- AA Index
def fetch_aa():
    html = http_get("https://artificialanalysis.ai/leaderboards/models").decode("utf-8", "replace")
    pat = re.compile(
        r'\\"name\\":\\"((?:[^\\]|\\.)*?)\\",\\"shortName\\":'
        r'.*?\\"modelCreatorName\\":\\"((?:[^\\]|\\.)*?)\\",'
        r'.*?\\"intelligenceIndex\\":([0-9.]+),'
        r'\\"intelligenceIndexIsEstimated\\":(true|false)',
        re.S,
    )
    best = {}
    for m in pat.finditer(html):
        raw = m.group(1).encode().decode("unicode_escape", "replace")
        org = m.group(2).encode().decode("unicode_escape", "replace")
        score, est = float(m.group(3)), m.group(4) == "true"
        if est:
            continue
        base = re.sub(r"\s*\([^)]*\)\s*$", "", raw).strip()
        if base not in best or score > best[base][1]:
            best[base] = (org, score)
    rows = sorted(best.items(), key=lambda kv: -kv[1][1])[:10]
    if len(rows) < 8:
        raise RuntimeError(f"AA parse yielded only {len(rows)} models")
    return [(name, org, round(score, 1)) for name, (org, score) in rows]


# ------------------------------------------------- Terminal-Bench via Supabase
SUPABASE = "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read"


def _fetch_supabase(package, name):
    d = http_post_json(SUPABASE, {"package": package, "name": name})
    best = {}
    for r in d["rows"]:
        md = r["metadata"]
        model = md["model_display"]["label"]
        # feed uses short labels ("Fable 5.1"); site style is "Claude Fable 5.1"
        if re.match(r"^(Fable|Opus|Sonnet)\b", model):
            model = "Claude " + model
        org = md["model_org"]["label"]
        acc = float(r["metrics"]["accuracy"])
        if model not in best or acc > best[model][1]:
            best[model] = (org, acc)
    rows = sorted(best.items(), key=lambda kv: -kv[1][1])[:10]
    if len(rows) < 5:
        raise RuntimeError(f"Supabase {package}/{name} yielded only {len(rows)} rows")
    return [(m, o, round(a, 1)) for m, (o, a) in rows]


def fetch_tb40():
    return _fetch_supabase("terminal-bench/terminal-bench", "4-0-0")


def fetch_tbscience():
    return _fetch_supabase("terminal-bench-science/terminal-bench-science", "v0-1-eval")


# ------------------------------------------------------------------ HLE (PDF)
HLE_NAMES = {
    "GPT 6 Astra": "GPT-6 Astra",
    "Fable 5.1 (xhigh)": "Claude Fable 5.1",
    "gemini-3.1-pro-preview (thinking high)": "Gemini 3.1 Pro Preview",
    "Gemini 3.8 Flash": "Gemini 3.8 Flash",
    "gpt-5.4-pro-2026-03-05": "GPT-5.4 Pro",
    "Muse Spark": "Muse Spark",
    "gemini-3-pro-preview": "Gemini 3 Pro Preview",
    "gpt-5.4-2026-03-05 (xhigh thinking)": "GPT-5.4",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6-thinking-max": "Claude Opus 4.6",
}
HLE_ORGS = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "meta": "Meta",
}


def fetch_hle():
    pdf = http_get("https://labs.scale.com/api/pdf/leaderboard/humanitys_last_exam")
    with open("/tmp/hle_lb.pdf", "wb") as f:
        f.write(pdf)
    txt = subprocess.run(
        ["pdftotext", "-layout", "/tmp/hle_lb.pdf", "-"],
        capture_output=True, text=True, timeout=60,
    ).stdout
    rows = []
    for line in txt.splitlines():
        m = re.match(r"\s*\d+\s{2,}(.+?)\s{2,}([a-z]+)\s+(\d+\.\d+)\s*$", line)
        if not m:
            continue
        raw_model = re.sub(r"\s*★\s*", "", m.group(1)).strip()
        raw_model = re.sub(r"\s+", " ", raw_model)
        prov, score = m.group(2), float(m.group(3))
        model = HLE_NAMES.get(raw_model, raw_model)
        org = HLE_ORGS.get(prov, prov.title())
        rows.append((model, org, round(score, 1)))
        if len(rows) == 10:
            break
    if len(rows) < 8:
        raise RuntimeError(f"HLE PDF parse yielded only {len(rows)} rows")
    return rows


# ------------------------------------------------------- FrontierCode (JSON-LD)
FC_ORGS = {
    "Claude Opus 5.5": "Anthropic",
    "Claude Fable 5": "Anthropic",
    "Claude Opus 5": "Anthropic",
    "Claude Fable 5.1": "Anthropic",
    "Claude Opus 4.8": "Anthropic",
    "Claude Opus 4.7": "Anthropic",
    "Claude Sonnet 5": "Anthropic",
    "GPT-6 Astra": "OpenAI",
    "GPT-6 Sol": "OpenAI",
    "GPT-5.6 Sol": "OpenAI",
    "GPT-5.6 Terra": "OpenAI",
    "GPT-5.6 Luna": "OpenAI",
    "GPT-5.5": "OpenAI",
    "Grok 4.6": "xAI",
    "Grok 4.7": "xAI",
    "SWE-2": "Cognition",
    "SWE-1.7": "Cognition",
    "Kimi K3": "Moonshot AI",
    "GLM-5.3": "Z AI",
    "DeepSeek V4.1 Flash": "DeepSeek",
    "Gemini 3.8 Flash": "Google",
    "Muse Spark 1.3": "Meta",
}


def fetch_frontiercode():
    html = http_get("https://cognition.com/frontiercode").decode("utf-8", "replace")
    rows = []
    for m in re.finditer(
        r'"@type":"ListItem","position":(\d+),"name":"([^"]+)","description":"Score ([0-9.]+)%',
        html,
    ):
        name, score = m.group(2), round(float(m.group(3)), 1)
        org = FC_ORGS.get(name)
        if org is None:
            raise RuntimeError(f"FrontierCode: unknown org for model '{name}' — update FC_ORGS")
        rows.append((int(m.group(1)), name, org, score))
    rows.sort()
    if len(rows) < 8:
        raise RuntimeError(f"FrontierCode JSON-LD yielded only {len(rows)} rows")
    return [(n, o, s) for _, n, o, s in rows[:10]]


# ------------------------------------------------- AutomationBench (GH README)
AB_ORGS = {
    "Claude Opus 5": "Anthropic",
    "Kimi K3": "Moonshot AI",
    "Claude Fable 5": "Anthropic",
    "GPT-5.6 Sol": "OpenAI",
    "Gemini 3.6 Flash": "Google",
    "Claude Opus 4.8": "Anthropic",
    "Gemini 3.5 Flash": "Google",
    "GPT-5.6 Terra": "OpenAI",
    "Claude Sonnet 5": "Anthropic",
    "GLM 5.2": "Z AI",
}


def fetch_automationbench():
    md = http_get(
        "https://raw.githubusercontent.com/zapier/AutomationBench/main/README.md"
    ).decode("utf-8", "replace")
    rows = []
    for m in re.finditer(r"\|\s*([^|]+?)\s*\|\s*(?:max|high|medium|low)\s*\|\s*([0-9.]+)%\s*\|", md):
        name, score = m.group(1).strip(), round(float(m.group(2)), 1)
        org = AB_ORGS.get(name)
        if org is None:
            raise RuntimeError(f"AutomationBench: unknown org for model '{name}' — update AB_ORGS")
        rows.append((name, org, score))
    rows.sort(key=lambda r: -r[2])
    if len(rows) < 8:
        raise RuntimeError(f"AutomationBench README yielded only {len(rows)} rows")
    return rows[:10]


FETCHERS = {
    "aa": fetch_aa,
    "tb": fetch_tb40,
    "hle": fetch_hle,
    "fc": fetch_frontiercode,
    "ab": fetch_automationbench,
    "tbs": fetch_tbscience,
}


def main():
    out = {
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "benchmarks": {},
    }
    for bid, fn in FETCHERS.items():
        rows = fn()
        out["benchmarks"][bid] = {"rows": [[m, o, s] for m, o, s in rows]}
        print(f"{bid}: {len(rows)} rows, leader {rows[0][0]} {rows[0][2]}", flush=True)
    with open("bench_refresh/benchmarks.json", "w") as f:
        json.dump(out, f, indent=1)
    print("wrote bench_refresh/benchmarks.json")


if __name__ == "__main__":
    sys.exit(main())
