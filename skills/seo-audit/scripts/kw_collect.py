#!/usr/bin/env python3
"""搜索需求：Google 自动补全（按各市场 gl/hl）→ 规则分类 → full/kw-library.json。没有搜索量，只有补全命中次数。

用法：python3 kw_collect.py --config full/audit.json [--build-only]
配置用到：seeds、seed_alphabet（再加「前缀 + a…l」扩展）、domain（必须命中）、noise（命中剔除）、brand、brand_terms、clusters。
品牌词若没出现在补全里，会按 brand_terms 补进词库（seedHits=0，标 source=brand_terms），保证实查时能查到品牌词。
--build-only 只用已有 kw-raw.jsonl 重新分类（改了 clusters 规则后用，不再请求）。
"""
import argparse, collections, json, os, re, string, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser(); ap.add_argument("--config", required=True); ap.add_argument("--build-only", action="store_true"); a = ap.parse_args()
C = _cfg.load(a.config); D = C["_dir"]; RAW = os.path.join(D, "kw-raw.jsonl")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"

if not a.build_only:
    out = open(RAW, "w"); n = 0
    for loc, L in C["locales"].items():
        pre = C.get("seed_alphabet", {}).get(loc)
        qs = list(C["seeds"].get(loc, [])) + ([f"{pre} {ch}" for ch in string.ascii_lowercase[:12]] if pre else [])
        for q in dict.fromkeys(qs):
            u = "https://suggestqueries.google.com/complete/search?client=firefox&" + urllib.parse.urlencode({"hl": L["hl"], "gl": L["gl"], "q": q})
            try:
                for i, k in enumerate(json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=20).read().decode("utf-8", "replace"))[1]):
                    out.write(json.dumps({"locale": loc, "seed": q, "keyword": k, "rank": i + 1}, ensure_ascii=False) + "\n"); n += 1
            except Exception as e:
                print("ERR", loc, q, e, file=sys.stderr)
            time.sleep(0.35)
        print(loc, "累计补全", n, file=sys.stderr)
    out.close()

DOM, NOISE, BR = re.compile(C["domain"], re.I), re.compile(C["noise"], re.I) if C.get("noise") else None, re.compile(C["brand"], re.I)
RULES = [(c, re.compile(p, re.I)) for c, p in C["clusters"]]
agg = {}
for r in map(json.loads, open(RAW)):
    kw = r["keyword"].strip()
    if not (DOM.search(kw) or BR.search(kw)) or (NOISE and NOISE.search(kw)): continue
    x = agg.setdefault((r["locale"], kw.lower()), {"keyword": kw, "locale": r["locale"], "seeds": set(), "bestRank": 99})
    x["seeds"].add(r["seed"]); x["bestRank"] = min(x["bestRank"], r["rank"])
for loc, terms in C.get("brand_terms", {}).items():
    for t in terms:
        agg.setdefault((loc, t.lower()), {"keyword": t, "locale": loc, "seeds": set(), "bestRank": 99, "source": "brand_terms"})
rows = []
for x in agg.values():
    kw = x["keyword"]
    cl = "品牌词" if BR.search(kw) and not any(rx.search(kw) for _, rx in RULES) else next((c for c, rx in RULES if rx.search(kw)), "通用品类词")
    if BR.search(kw) and cl != "品牌词" and len(kw.split()) <= 2: cl = "品牌词"
    rows.append({"keyword": kw, "locale": x["locale"], "cluster": cl, "seedHits": len(x["seeds"]), "bestRank": x["bestRank"], "source": x.get("source", "google-suggest")})
rows.sort(key=lambda r: (r["locale"], r["cluster"], -r["seedHits"], r["bestRank"]))
json.dump(rows, open(os.path.join(D, "kw-library.json"), "w"), ensure_ascii=False, indent=1)
print("词库", len(rows), dict(collections.Counter(r["locale"] for r in rows)))
for loc in [l for l in C["locales"] if C["seeds"].get(l)]:
    cnt = collections.Counter(r["cluster"] for r in rows if r["locale"] == loc); print(loc, dict(cnt))
    for c in cnt: print("  ", c, [r["keyword"] for r in rows if r["locale"] == loc and r["cluster"] == c][:6])
print("逐类看一遍：分类错的改 clusters 规则后用 --build-only 重跑；无关词加进 noise。", file=sys.stderr)
