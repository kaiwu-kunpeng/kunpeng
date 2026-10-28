#!/usr/bin/env python3
"""从 serp_rank.py 的缓存统计 Google AI 概览：出现数、带引用数、折叠未展开数、引用本站数、按市场/主题分布、通用问题点名率。

用法：python3 aio_stats.py --config full/audit.json（或 --out <目录> --domain <域名> --brand <正则> --review-clusters 评价,对比）
--brand 是品牌与品牌化技术词的正则：查询词命中它就不算「通用问题」（品牌专有的技术名、产品线名也要放进去，否则通用问题的点名率会被抬高）。
口径（踩过的坑，别改）：
  · ai_overview 只有 error 字段 = Google 明确说这次没有 AI 概览，不计入出现数；
  · 只有 page_token、没有 references = 引用列表折叠，要额外请求才能展开，单列为「未展开」，不能当作「没引用本站」；
  · 引用计数按「引用了该域名的概览条数」，不是引用条目数（同一条概览会重复列同一域名）。
输出 <out>/aio-stats.json 并打印摘要。
"""
import argparse, collections, glob, hashlib, json, os, re

ap = argparse.ArgumentParser()
ap.add_argument("--config"); ap.add_argument("--out"); ap.add_argument("--domain"); ap.add_argument("--brand")
ap.add_argument("--review-clusters", default="", help="评价、对比类主题名（逗号分隔，与词库 cluster 名一致）；读配置时取 review_clusters")
a = ap.parse_args()
if a.config:
    import sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import _cfg
    _C = _cfg.load(a.config); a.out = a.out or _C["_dir"]; a.domain = a.domain or _C["_domain"]; a.brand = a.brand or _C["brand"]
    a.review_clusters = a.review_clusters or ",".join(_C.get("review_clusters", []))
if not (a.out and a.domain and a.brand): raise SystemExit("需要 --config，或 --out --domain --brand")
rows = json.load(open(os.path.join(a.out, "serp-rank.json")))["rows"]
meta = {(r["locale"], hashlib.sha1(f"{r['locale']}|{r['keyword']}".encode()).hexdigest()[:16]): r for r in rows}
BR = re.compile(a.brand, re.I); RC = set(x for x in a.review_clusters.split(",") if x)

n = with_ref = folded = no_aio = cited = 0
by_loc, by_cl, dom = collections.Counter(), collections.Counter(), collections.Counter()
review, generic = [], []
for f in sorted(glob.glob(os.path.join(a.out, "serp-raw", "*", "*.json"))):
    loc = f.split(os.sep)[-2]; r = meta.get((loc, os.path.basename(f)[:-5]))
    if not r: continue  # 补查文件（如第二页）不在主样本里
    ao = json.load(open(f)).get("ai_overview")
    if not ao: continue
    if ao.get("error") and not (ao.get("references") or ao.get("page_token") or ao.get("text_blocks")): no_aio += 1; continue
    n += 1
    refs = ao.get("references") or []
    if not BR.search(r["keyword"]) and ao.get("text_blocks"):
        generic.append({"locale": loc, "keyword": r["keyword"], "named": bool(BR.search(json.dumps(ao["text_blocks"], ensure_ascii=False)))})
    if not refs: folded += 1; continue
    with_ref += 1
    hosts = {x.get("link", "").split("/")[2].removeprefix("www.") for x in refs if x.get("link", "").count("/") >= 2}
    for h in hosts: dom[h] += 1
    if r["cluster"] in RC: review.append(sorted(hosts))
    if any(h.endswith(a.domain) for h in hosts): cited += 1; by_loc[loc] += 1; by_cl[r["cluster"]] += 1
out = {"aio": n, "withRefs": with_ref, "folded": folded, "explicitNoAio": no_aio, "cited": cited, "citedByLocale": by_loc, "citedByCluster": by_cl,
       "topDomains": dom.most_common(15), "reviewCompare": review, "generic": generic, "genericNamed": sum(g["named"] for g in generic)}
json.dump(out, open(os.path.join(a.out, "aio-stats.json"), "w"), ensure_ascii=False, indent=1)
print(f"AI 概览 {n} 条（另 {no_aio} 条明确无概览）；带引用 {with_ref}，折叠未展开 {folded}；引用本站 {cited}；"
      f"评价/对比类带引用 {len(review)}；通用问题 {len(generic)} 个，点名 {out['genericNamed']} 个")
