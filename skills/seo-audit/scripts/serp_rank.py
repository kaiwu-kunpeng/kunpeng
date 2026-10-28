#!/usr/bin/env python3
"""各市场 Google 实查排名（SerpApi）。每条结果缓存到 <out>/serp-raw/<locale>/<sha1(locale|kw)[:16]>.json，重跑不重复扣额度。

用法（推荐，读审计配置）：
  python3 serp_rank.py --config full/audit.json [--dry-run] [--requery-corrected]
兼容旧参数：--domain <域名> --markets markets.json --keywords kw.json --out <目录> [--per 14]

Google 会把陌生品牌词自动纠正（如 exampletravel → example travel），此时结果是纠正后的词，不是品牌词本身。
脚本记录 corrected / showingResultsFor；加 --requery-corrected 会对被纠正的品牌词用 nfpr=1（按原拼写）再查一次，各多扣 1 次额度。
报告里说「第一页」，不说「前 10」：Google 常只返回 8–9 条自然结果，organicCount 字段记录了实际条数。

markets.json：{"de": {"gl": "de", "hl": "de", "google_domain": "google.de", "label": "德国"}, ...}
kw.json：[{"keyword": "...", "locale": "de", "cluster": "品牌词"}, ...]（cluster 用于按主题轮流挑词）
key：环境变量 SERPAPI_KEY，或 ~/.kunpeng/seo-keys.env 里的 SERPAPI_KEY=。
--dry-run 只打印每个市场挑中的词和预计消耗，不发请求。输出 <out>/serp-rank.json。
"""
import argparse, collections, hashlib, json, os, sys, time, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--config"); ap.add_argument("--domain", help="被审站点的注册域名")
ap.add_argument("--markets"); ap.add_argument("--keywords"); ap.add_argument("--out")
ap.add_argument("--per", type=int, help="每个市场查几个词（默认读配置 serp_per_market，否则 14）")
ap.add_argument("--order", default="", help="主题轮流顺序（逗号分隔，与词库 cluster 名完全一致）；默认：品牌词 + 配置 clusters 的顺序")
ap.add_argument("--exclude", default="", help="逗号分隔的剔除词；写成 词@locale 表示只在该市场保留（如 pakistan@pk）")
ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--requery-corrected", action="store_true")
a = ap.parse_args()
if a.config:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import _cfg
    _C = _cfg.load(a.config)
    a.domain = a.domain or _C["_domain"]; a.out = a.out or _C["_dir"]
    a.per = a.per or _C.get("serp_per_market", 14); a.exclude = a.exclude or _C.get("serp_exclude", "")
    a.order = a.order or ",".join(["品牌词"] + [c for c, _ in _C.get("clusters", [])] + ["通用品类词"])
    MARKETS = {k: {"gl": v["gl"], "hl": v["hl"], "google_domain": v["google_domain"], "label": v.get("label", k)} for k, v in _C["locales"].items() if v.get("gl")}  # 只查配置了 Google 参数的市场
    KW = json.load(open(os.path.join(a.out, "kw-library.json")))
else:
    if not (a.domain and a.markets and a.keywords and a.out): sys.exit("需要 --config，或同时给 --domain --markets --keywords --out")
    MARKETS = json.load(open(a.markets)); KW = json.load(open(a.keywords)); a.per = a.per or 14

ORDER = [x.strip() for x in a.order.split(",") if x.strip()]
EXCL = [(x.split("@")[0].strip().lower(), x.split("@")[1].strip() if "@" in x else None) for x in a.exclude.split(",") if x.strip()]


def key():
    if os.environ.get("SERPAPI_KEY"): return os.environ["SERPAPI_KEY"]
    p = os.path.expanduser("~/.kunpeng/seo-keys.env")
    for l in (open(p) if os.path.exists(p) else []):
        if l.startswith("SERPAPI_KEY="): return l.strip().split("=", 1)[1]
    sys.exit("缺 SERPAPI_KEY：写进 ~/.kunpeng/seo-keys.env（SERPAPI_KEY=…）或设环境变量")


UNMATCHED = collections.Counter()


def pick(rows):
    by = collections.defaultdict(list)
    for r in rows:
        if any(t in r["keyword"].lower() and keep != r["locale"] for t, keep in EXCL): continue
        c = r.get("cluster", "") if r.get("cluster", "") in ORDER else "其他"
        if c == "其他" and ORDER: UNMATCHED[r.get("cluster", "")] += 1
        by[c].append(r)
    for c in by: by[c].sort(key=lambda r: (-(r.get("seedHits") or 0), r.get("bestRank") or 99, len(r["keyword"])))
    out = []
    while len(out) < a.per and any(by.values()):
        for c in ORDER + ["其他"]:
            if by.get(c) and len(out) < a.per: out.append(by[c].pop(0))
    return out


def host(u): return urllib.parse.urlparse(u).netloc.lower().removeprefix("www.")


def cache_path(loc, q): return os.path.join(a.out, "serp-raw", loc, hashlib.sha1(f"{loc}|{q}".encode()).hexdigest()[:16] + ".json")


def fetch(loc, q, k, nfpr=False):
    p = cache_path(loc, q) if not nfpr else cache_path(loc, q)[:-5] + "-nfpr.json"
    if os.path.exists(p): return json.load(open(p)), False
    m = MARKETS[loc]
    qs = urllib.parse.urlencode({"engine": "google", "q": q, "gl": m["gl"], "hl": m["hl"], "google_domain": m["google_domain"], "num": 10, "api_key": k, **({"nfpr": 1} if nfpr else {})})
    err = ""
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen("https://serpapi.com/search.json?" + qs, timeout=60)); break
        except Exception as ex:
            err = str(ex); time.sleep(3)
    else:
        return {"error": err}, False
    if d.get("error"): return d, False  # 错误不写缓存，下次重试
    os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(d, open(p, "w"), ensure_ascii=False)
    return d, True


plan = {loc: pick([r for r in KW if r["locale"] == loc]) for loc in MARKETS}
need = sum(1 for loc, rs in plan.items() for r in rs if not os.path.exists(cache_path(loc, r["keyword"])))
if a.dry_run:
    for loc, rs in plan.items(): print(loc, " | ".join(f"{r['keyword']}〔{r.get('cluster','')}〕" for r in rs))
    if UNMATCHED: print("注意：这些 cluster 不在 --order 里，归入「其他」：", dict(UNMATCHED))
    print(f"共 {sum(len(v) for v in plan.values())} 次，其中需新请求 {need} 次（其余命中缓存）"); sys.exit(0)

k = key() if need else ""
res, spent = [], 0


def parse(d):
    org = d.get("organic_results", [])
    hits = [{"pos": o.get("position"), "url": o.get("link")} for o in org if host(o.get("link", "")).endswith(a.domain)]
    top = hits[0] if hits else None
    path = urllib.parse.urlparse(top["url"]).path if top else ""
    si = d.get("search_information", {})
    return {"sitePos": top["pos"] if top else None, "siteUrl": top["url"] if top else None,
            "landingLocale": path.strip("/").split("/")[0] if top else None,
            # PDF 与静态资源不是语种页，不计入「落错语种」
            "pdf": bool(top) and ("/static/" in path or path.lower().endswith(".pdf")),
            "organicCount": len(org), "corrected": si.get("organic_results_state", "") not in ("", "Results for exact spelling"),
            "showingResultsFor": si.get("showing_results_for") or si.get("spelling_fix"),
            "top3": [host(o.get("link", "")) for o in org[:3]], "domains": [host(o.get("link", "")) for o in org[:10]]}


for loc, rs in plan.items():
    for r in rs:
        d, paid = fetch(loc, r["keyword"], k); spent += paid
        row = {"locale": loc, "market": MARKETS[loc].get("label", loc), "keyword": r["keyword"], "cluster": r.get("cluster", ""), "error": d.get("error"), **parse(d)}
        if row["corrected"] and a.requery_corrected and r.get("cluster") == "品牌词":
            k = k or key(); d2, paid2 = fetch(loc, r["keyword"], k, nfpr=True); spent += paid2
            row["exact"] = parse(d2)
        res.append(row)
json.dump({"date": time.strftime("%Y-%m-%d"), "domain": a.domain, "per": a.per, "spentThisRun": spent, "rows": res},
          open(os.path.join(a.out, "serp-rank.json"), "w"), ensure_ascii=False, indent=1)
hit = [r for r in res if r["sitePos"]]; wrong = [r for r in hit if not r["pdf"] and r["landingLocale"] != r["locale"]]
print(f"查询 {len(res)}，本次扣额度 {spent}，进第一页 {len(hit)}，前 3 {sum(1 for r in hit if r['sitePos'] <= 3)}，落错语种 {len(wrong)}，PDF {sum(1 for r in hit if r['pdf'])}，"
      f"被自动纠正 {sum(1 for r in res if r['corrected'])}，错误 {sum(1 for r in res if r['error'])}")
if any(r["corrected"] for r in res) and not a.requery_corrected:
    print("有查询被 Google 自动纠正（见 corrected / showingResultsFor）。品牌词被纠正时，报告要写明，必要时加 --requery-corrected 按原拼写重查。")
