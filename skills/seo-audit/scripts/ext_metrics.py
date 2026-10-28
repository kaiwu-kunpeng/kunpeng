#!/usr/bin/env python3
"""外链与 AI 可见度：把第三方 SEO 数据平台的读数规范成评分要用的通过率。

用法：python3 ext_metrics.py --config full/audit.json
输入（都在 full/external/，采集方法见 references/data-collection.md 第 12 节；缺哪个就对应检查项记未测）：
  backlinks.csv          平台「外链对比」导出，分号分隔，至少含 target;ascore;backlinks_num;domains_num;follows_num 五列，一个根域名一行
  authority_profile.json 本站引荐域名按权威度（0–100）的分布 {"0": n, "1": n, ...}，可缺
  ai_visibility.json     {"pulled": 日期, "markets": {"de": {"visibility": {域名: 0–100}, "sources": {"all": n, "missing": n}}}}
配置：external.peers 是参与中位数比较的竞品根域名（同一家多个域名只放一个）；external.low_authority_max 默认 2。
口径（别改）：
  · 外链两个检查项 = min(1, 本站 ÷ 竞品中位数)，权威度评分、引荐域名各一项；中位数用 statistics.median（竞品数为奇数时取正中一个）
  · 推荐率 = 各市场本站 AI 可见度的平均 ÷ 100
  · 来源页覆盖 = 各市场 (1 − missing ÷ all) 的平均，用全量来源，不用前 100 来源
输出 full/ext-metrics.json 并打印摘要。
"""
import argparse, csv, json, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True)
a = ap.parse_args()
C = _cfg.load(a.config)
X = C.get("external", {})
D = os.path.join(C["_dir"], "external")
me = C["_domain"]
out = {"domain": me, "pulled": X.get("pulled", "")}


def num(v): return float(v) if "." in str(v) else int(v)


p = os.path.join(D, "backlinks.csv")
if os.path.exists(p):
    rows = {r["target"].removeprefix("www."): r for r in csv.DictReader(open(p), delimiter=";")}
    if me not in rows: sys.exit(f"backlinks.csv 里没有本站 {me}")
    peers = X.get("peers") or sys.exit("配置缺 external.peers（参与中位数比较的竞品根域名）")
    miss = [d for d in peers if d not in rows]
    if miss: sys.exit(f"backlinks.csv 缺竞品：{miss}")
    pick = lambda d: {"authority": num(rows[d]["ascore"]), "ref_domains": num(rows[d]["domains_num"]),
                      "backlinks": num(rows[d]["backlinks_num"]), "follow": num(rows[d]["follows_num"])}
    table = {d: pick(d) for d in [me] + peers}
    for v in table.values(): v["follow_share"] = round(v["follow"] / v["backlinks"], 4) if v["backlinks"] else None
    med_as = statistics.median(table[d]["authority"] for d in peers)
    med_rd = statistics.median(table[d]["ref_domains"] for d in peers)
    out["backlinks"] = {
        "table": table, "median_authority": med_as, "median_ref_domains": med_rd,
        "checks": {"authority_vs_median": round(min(1, table[me]["authority"] / med_as), 4),
                   "ref_domains_vs_median": round(min(1, table[me]["ref_domains"] / med_rd), 4)}}
    pp = os.path.join(D, "authority_profile.json")
    if os.path.exists(pp):
        prof = {int(k): v for k, v in json.load(open(pp)).items()}
        lo = X.get("low_authority_max", 2); tot = sum(prof.values())
        out["backlinks"]["authority_profile"] = {
            "total": tot, "low_max": lo, "low": sum(v for k, v in prof.items() if k <= lo),
            "ge20": sum(v for k, v in prof.items() if k >= 20)}
        out["backlinks"]["authority_profile"]["low_share"] = round(out["backlinks"]["authority_profile"]["low"] / tot, 4)

p = os.path.join(D, "ai_visibility.json")
if os.path.exists(p):
    V = json.load(open(p))
    mk = {m: v for m, v in V["markets"].items() if me in v.get("visibility", {})}
    if not mk: sys.exit(f"ai_visibility.json 里没有本站 {me} 的可见度")
    vis = {m: v["visibility"][me] for m, v in mk.items()}
    cov = {m: round(1 - v["sources"]["missing"] / v["sources"]["all"], 4) for m, v in mk.items() if v.get("sources", {}).get("all")}
    out["ai_visibility"] = {
        "pulled": V.get("pulled", ""), "markets": sorted(mk), "visibility": vis,
        "ranking": {m: sorted(v["visibility"].items(), key=lambda kv: -kv[1]) for m, v in mk.items()},
        "source_coverage": cov,
        "sources": {m: v["sources"] for m, v in mk.items() if "sources" in v},
        "checks": {"recommend_rate": round(statistics.mean(vis.values()) / 100, 4),
                   "source_coverage": round(statistics.mean(cov.values()), 4) if cov else None}}

json.dump(out, open(os.path.join(C["_dir"], "ext-metrics.json"), "w"), ensure_ascii=False, indent=1)
b = out.get("backlinks"); v = out.get("ai_visibility")
print("外链：" + (f"权威度 {b['table'][me]['authority']}（竞品中位 {b['median_authority']}）→ {b['checks']['authority_vs_median']:.0%}；"
                 f"引荐域名 {b['table'][me]['ref_domains']:,}（中位 {b['median_ref_domains']:,}）→ {b['checks']['ref_domains_vs_median']:.0%}" if b else "未测"))
print("AI 可见度：" + (f"{v['visibility']} → 推荐率 {v['checks']['recommend_rate']:.1%}；来源页覆盖 {v['source_coverage']} → {v['checks']['source_coverage']:.1%}" if v else "未测"))
