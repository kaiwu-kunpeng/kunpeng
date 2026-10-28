#!/usr/bin/env python3
"""在落盘 HTML 与 pages.jsonl 上算报告用的派生指标，写 full/analysis.json。每个比例都同时落「分子 / 分母」，报告直接引用，不再自己算。

用法：python3 analyze.py --config full/audit.json
依赖 crawl.py 的产物。覆盖：各语种页数、lang 合法性、正文语言一致性、hreflang（有对应版本的页里的覆盖率、回链对称、x-default）、
标题（像素宽度、重复、公共后缀）、description、H1、图片、og:image、结构化数据、noindex、重点页主关键词（标题 / 首段）、
入链与内部 PageRank、点击深度、只能从 sitemap 到达、页型位次、最高级宣称与同段出处。
"""
import argparse, collections, gzip, json, os, re, statistics, sys, urllib.parse
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser(); ap.add_argument("--config", required=True); a = ap.parse_args()
C = _cfg.load(a.config); D = C["_dir"]; O = C["_origin"]
R = [json.loads(l) for l in open(os.path.join(D, "pages.jsonl"))]
H = [r for r in R if r["status"] == 200 and "html" in (r.get("ctype") or "") and r.get("title") is not None]
URLS = [r["url"] for r in H]; BY = {r["url"]: r for r in H}
try:
    from PIL import ImageFont
    FONT = next((ImageFont.truetype(p, 20) for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf", "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf") if os.path.exists(p)), None)
except Exception:
    FONT = None


def title_px(t):
    """Google 桌面结果标题约 Arial 20px；没有字体时按字符类估算（中日韩 20px、泰文 11px、其他 9.5px）。"""
    if FONT: return round(FONT.getlength(t))
    return round(sum(20 if re.match(r"[぀-ヿ㐀-鿿가-힯]", ch) else 11 if re.match(r"[฀-๿]", ch) else 9.5 for ch in t))


SW = {"en": "the and of to for in is you your with on that this are be or can what how it from at by as",
      "de": "der die das und zu für ist du mit auf nicht eine ein den dem des oder wie bei nach von auch sie",
      "fr": "le la les et des du pour est vous avec sur une un dans que qui par pas plus au",
      "es": "el la los las y de del para es con una un en que por se su al como más",
      "it": "il la le e di del per è con una un in che si non dei della al come più",
      "nl": "de het een en van voor is met op niet dat die zijn ook als bij aan",
      "pl": "i w na z do się jest nie że to jak od dla po ale oraz",
      "cs": "a v na je se že s z do to jak pro od po ale jsou",
      "pt": "o a os as e de do da para é com um uma em que por se"}
SW = {k: set(v.split()) for k, v in SW.items()}


def detect(text):
    if len(text) < 200: return None  # 太短不判
    cj = len(re.findall(r"[㐀-鿿]", text)); kana = len(re.findall(r"[぀-ヿ]", text)); ko = len(re.findall(r"[가-힯]", text)); th = len(re.findall(r"[฀-๿]", text))
    n = len(text)
    if kana > n * 0.03: return "ja"
    if ko > n * 0.1: return "ko"
    if th > n * 0.1: return "th"
    if cj > n * 0.1: return "zh"
    w = re.findall(r"[a-zà-ÿąćęłńóśźżčďěňřšťůž]+", text.lower())
    sc = {k: sum(1 for x in w if x in s) for k, s in SW.items()}
    best = max(sc, key=sc.get)
    return best if sc[best] >= 5 else None


LANG_RX = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
ISO1 = set("aa ab af am ar as az be bg bn bo bs ca cs cy da de el en eo es et eu fa fi fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ms my nb ne nl nn no pa pl ps pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh zu".split())


def lang_valid(v): return bool(v) and bool(LANG_RX.match(v)) and v.split("-")[0].lower() in ISO1


def soup(url):
    s = BeautifulSoup(gzip.open(_cfg.html_file(C, url), "rt", encoding="utf-8").read(), "html.parser")
    for t in s(["script", "style", "noscript"]): t.decompose()
    return s


P = {}
for u in URLS:
    s = soup(u); main = s.find("main") or s.body or s
    text = main.get_text(" ", strip=True)
    fp = next((x.get_text(" ", strip=True) for x in main.find_all("p") if len(x.get_text(strip=True)) > 40), "")
    P[u] = {"loc": _cfg.locale_of(C, u), "type": _cfg.page_type(C, u), "key": _cfg.strip_locale(C, u), "text": text, "firstP": fp, "main": main}

# ---- 语种、lang、正文语言 ----
by_loc = collections.Counter(P[u]["loc"] for u in URLS)
lang_rows = {}
for loc, L in C["locales"].items():
    us = [u for u in URLS if P[u]["loc"] == loc]; exp = L.get("lang", loc).lower()
    vals = collections.Counter(BY[u].get("lang") or "（缺失）" for u in us)
    ok = sum(1 for u in us if lang_valid(BY[u].get("lang")) and BY[u]["lang"].lower().split("-")[0] == exp.split("-")[0])
    judged = [(u, detect(P[u]["text"])) for u in us]; judged = [(u, d) for u, d in judged if d]
    mism = [(u, d) for u, d in judged if d != exp.split("-")[0]]
    lang_rows[loc] = {"pages": len(us), "langValues": vals.most_common(), "langOk": ok, "judged": len(judged), "bodyMismatch": len(mism),
                      "mismatchLangs": collections.Counter(d for _, d in mism).most_common(), "mismatchExamples": [u for u, _ in mism[:8]]}
lang_bad_total = sum(1 for u in URLS if not lang_valid(BY[u].get("lang")))

# ---- hreflang ----
groups = collections.defaultdict(set)
for u in URLS: groups[P[u]["key"]].add(P[u]["loc"])
has_cp = [u for u in URLS if len(groups[P[u]["key"]]) >= 2]  # 该内容在别的语种也有版本
with_h = [u for u in URLS if BY[u]["hreflang"]]
cp_with_h = [u for u in has_cp if BY[u]["hreflang"]]
norm = lambda x: (x or "").rstrip("/")
urlset = {norm(u) for u in URLS}
asym = 0
for u in with_h:
    for lg, href in BY[u]["hreflang"]:
        t = norm(urllib.parse.urljoin(u, href or ""))
        if t in urlset and t != norm(u):
            tgt = next((x for x in URLS if norm(x) == t), None)
            if tgt and not any(norm(urllib.parse.urljoin(tgt, h2 or "")) == norm(u) for _, h2 in BY[tgt]["hreflang"]): asym += 1
xdef = sum(1 for u in with_h if any(lg == "x-default" for lg, _ in BY[u]["hreflang"]))

# ---- 标题、描述、H1、图片 ----
titles = {u: (BY[u]["title"] or "").strip() for u in URLS}
px = {u: title_px(t) for u, t in titles.items()}
tails = collections.Counter(m.group(0) for t in titles.values() if (m := re.search(r"\s[|–—-]\s[^|–—-]{2,40}$", t)))
suffix, suffix_n = (tails.most_common(1)[0] if tails else ("", 0))
dup_titles = [t for t, n in collections.Counter(titles.values()).items() if n > 1 and t]
imgs = {k: sum(BY[u]["img"][k] for u in URLS) for k in ("total", "noAlt", "noDims", "modern", "lazy")}

# ---- 重点页 ----
key = []
for k in C.get("key_pages", []):
    u = _cfg.abs_url(C, k["url"]); cand = [x for x in URLS if norm(x) == norm(u)]
    if not cand: key.append({**k, "missing": True}); continue
    u = cand[0]; rx = re.compile(k["match"], re.I)
    key.append({**k, "title": titles[u], "inTitle": bool(rx.search(titles[u])), "inFirstP": bool(rx.search(P[u]["firstP"])), "firstP": P[u]["firstP"][:160]})

# ---- 入链、PageRank ----
idx = {u: i for i, u in enumerate(URLS)}; alias = {norm(u): u for u in URLS}
out = {u: sorted({alias[norm(v)] for v in BY[u].get("outlinks", []) if norm(v) in alias and alias[norm(v)] != u}) for u in URLS}
indeg = collections.Counter(v for u in URLS for v in out[u])
N = len(URLS); pr = {u: 1 / N for u in URLS}
for _ in range(50):
    nx = {u: 0.15 / N for u in URLS}; dang = sum(pr[u] for u in URLS if not out[u])
    for u in URLS:
        for v in out[u]: nx[v] += 0.85 * pr[u] / len(out[u])
    for u in URLS: nx[u] += 0.85 * dang / N
    pr = nx
rank = {u: i + 1 for i, u in enumerate(sorted(URLS, key=lambda u: -pr[u]))}
tr = collections.defaultdict(list)
for u in URLS: tr[P[u]["type"]].append(rank[u])

# ---- 宣称与出处 ----
hint = re.compile(C["claim_source_hint"], re.I) if C.get("claim_source_hint") else None
claims = []; seen = set()
for u in URLS:
    rx = C.get("claims", {}).get(P[u]["loc"])
    if not rx: continue
    rx = re.compile(rx, re.I)
    for blk in P[u]["main"].find_all(["p", "li"]):
        t = blk.get_text(" ", strip=True); m = rx.search(t)
        if not m or len(t) < 30 or t[:120] in seen: continue
        seen.add(t[:120])
        ext = [x["href"] for x in blk.find_all("a", href=True) if x["href"].startswith("http") and C["_domain"] not in x["href"]]
        claims.append({"url": u, "word": m.group(0).lower(), "text": t[:200], "sourced": bool(ext) or bool(hint and hint.search(t))})

med = lambda xs: statistics.median(xs) if xs else None
res = {
    "_denominators": "pages = 200 且为 HTML 的页面数；各语种比例的分母是该语种页数；hreflang 覆盖的分母是有其他语种对应版本的页面数",
    "pages": N, "statuses": collections.Counter(r["status"] for r in R), "sources": collections.Counter(r["source"] for r in R),
    "sitemapOnly": sum(1 for u in URLS if BY[u]["source"] == "sitemap-only"), "byLocale": by_loc, "lang": lang_rows, "langBadTotal": lang_bad_total,
    "hreflang": {"pagesWith": len(with_h), "pagesWithCounterpart": len(has_cp), "counterpartWith": len(cp_with_h), "asymmetricLinks": asym, "xDefault": xdef},
    "titles": {"over600": sum(1 for v in px.values() if v > 600), "pxMedian": med(list(px.values())), "pxMax": max(px.values()) if px else 0,
               "commonSuffix": suffix.strip(), "suffixCount": suffix_n, "duplicateGroups": len(dup_titles), "duplicateExamples": dup_titles[:5], "empty": sum(1 for t in titles.values() if not t)},
    "descEmpty": sum(1 for u in URLS if not (BY[u].get("desc") or "").strip()),
    "descEmptyByLocale": {loc: sum(1 for u in URLS if P[u]["loc"] == loc and not (BY[u].get("desc") or "").strip()) for loc in C["locales"]},
    "h1": {"missing": sum(1 for u in URLS if BY[u]["h1"] == 0), "multiple": sum(1 for u in URLS if BY[u]["h1"] > 1)},
    "images": imgs, "ogAbsolute": sum(1 for u in URLS if (BY[u].get("ogImage") or "").startswith("http")), "ogMissing": sum(1 for u in URLS if not BY[u].get("ogImage")),
    "jsonld": collections.Counter(t for u in URLS for t in set(BY[u]["jsonld"])).most_common(), "jsonldPages": sum(1 for u in URLS if BY[u]["jsonld"]),
    "jsonldByType": {t: sum(1 for u in URLS if P[u]["type"] == t and BY[u]["jsonld"]) for t in tr},
    "noindex": [u for u in URLS if "noindex" in (BY[u].get("robots") or "").lower()],
    "keyPages": key, "keyInTitle": sum(1 for k in key if k.get("inTitle")), "keyInFirstP": sum(1 for k in key if k.get("inFirstP")), "keyTotal": len(key),
    "inlinks": {"zero": sum(1 for u in URLS if indeg[u] == 0), "one": sum(1 for u in URLS if indeg[u] == 1), "median": med([indeg[u] for u in URLS])},
    "depth": collections.Counter(BY[u]["depth"] for u in URLS),
    "typeRank": {t: {"n": len(v), "medianRank": med(v)} for t, v in tr.items()},
    "pagerankTop": [[u, round(pr[u] * 1000, 2), indeg[u], P[u]["type"]] for u in sorted(URLS, key=lambda u: -pr[u])[:20]],
    "claims": {"count": len(claims), "sourced": sum(c["sourced"] for c in claims), "byWord": collections.Counter(c["word"] for c in claims).most_common(), "examples": claims[:30]},
    "words": {loc: med([len(P[u]["text"].split()) for u in URLS if P[u]["loc"] == loc]) for loc in C["locales"]},
}
json.dump(res, open(os.path.join(D, "analysis.json"), "w"), ensure_ascii=False, indent=1, default=list)
print("页面", N, "| 只能从 sitemap 到达", res["sitemapOnly"], "| lang 非法", lang_bad_total, "| hreflang", res["hreflang"])
print("标题超 600px", res["titles"]["over600"], "| 公共后缀", repr(suffix.strip()), suffix_n, "| 重复标题组", len(dup_titles), "| 空描述", res["descEmpty"], "| H1 缺失", res["h1"]["missing"])
print("重点页标题含主词", res["keyInTitle"], "/", len(key), "| 首段含主词", res["keyInFirstP"], "| 入链 0/1", res["inlinks"]["zero"], res["inlinks"]["one"], "| 宣称", len(claims), "有出处", res["claims"]["sourced"])
for loc, v in lang_rows.items(): print(loc, v["pages"], "lang 正确", v["langOk"], "正文语言判定", v["judged"], "不一致", v["bodyMismatch"])
