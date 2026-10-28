#!/usr/bin/env python3
"""GEO 实测汇总：把在各 AI 网页端逐题问出来的回答（人工/浏览器采集）汇总成准确率、推荐与错误清单。

用法：python3 geo_probe.py --config full/audit.json
输入（full/geo/，题集与采集方法见 references/data-collection.md 第 13 节）：
  questions.json  {"version": "...", "frozen": 日期, "markets": {"de": {"gl": "de", "hl": "de", "q": {"N1": "...", "B1": "..."}}}}
                  N 开头 = 不含品牌的题（推荐），B 开头 = 品牌题（介绍准确）。复测必须原样使用同一版题集。
  answers.jsonl   一行一个回答：{"engine", "market", "qid", "mentioned", "recommended", "rank", "brands", "citations",
                  "accurate", "errors": [{"claim", "official"}], "memory_biased"}
                  accurate 只对 B 题填（对照 full/geo/facts.json 的官方参数，只计参数性错误；官方没写的标 null 不计）；
                  memory_biased=true 表示用自家登录账号问的（临时聊天也带记忆），这类回答的推荐数据不计分。
输出 full/geo-probe.json：
  accuracy   B 题：n / ok / 各引擎 [ok, n] / 错误清单 → 「AI 介绍准确」检查项
  recommend  N 题：只统计 memory_biased 为假的回答；没有干净样本时 rate 为 null（推荐率改用 ext_metrics 的 AI 可见度或记未测）
  citations  N 题回答引用的域名计数
"""
import argparse, collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True)
a = ap.parse_args()
C = _cfg.load(a.config)
G = os.path.join(C["_dir"], "geo")
Q = json.load(open(os.path.join(G, "questions.json")))
A = [json.loads(l) for l in open(os.path.join(G, "answers.jsonl")) if l.strip()]

bad = [x for x in A if x["market"] not in Q["markets"] or x["qid"] not in Q["markets"][x["market"]]["q"]]
if bad: sys.exit(f"{len(bad)} 条回答对不上题集（市场或题号不存在），例如 {bad[0]}")

B = [x for x in A if x["qid"].startswith("B") and x.get("accurate") is not None]
by_eng = collections.defaultdict(lambda: [0, 0])
for x in B:
    by_eng[x["engine"]][1] += 1; by_eng[x["engine"]][0] += bool(x["accurate"])
acc = {"n": len(B), "ok": sum(bool(x["accurate"]) for x in B), "by_engine": dict(by_eng),
       "errors": [{"market": x["market"], "qid": x["qid"], "engine": x["engine"], **e}
                  for x in B if not x["accurate"] for e in x.get("errors", [])]}
acc["rate"] = round(acc["ok"] / acc["n"], 4) if acc["n"] else None
no_detail = [f'{x["engine"]}/{x["market"]}/{x["qid"]}' for x in B if not x["accurate"] and not x.get("errors")]
if no_detail: sys.exit(f"判为不准确却没写 errors 的回答：{no_detail}（报告的错误表要从这里生成）")

N = [x for x in A if x["qid"].startswith("N")]
clean = [x for x in N if not x.get("memory_biased")]
rec = {"n_all": len(N), "n_clean": len(clean), "mentioned": sum(bool(x.get("mentioned")) for x in clean),
       "recommended": sum(bool(x.get("recommended")) for x in clean),
       "rate": round(sum(bool(x.get("recommended")) for x in clean) / len(clean), 4) if clean else None,
       "by_market": {m: [sum(bool(x.get("recommended")) for x in clean if x["market"] == m), sum(x["market"] == m for x in clean)]
                     for m in sorted({x["market"] for x in clean})}}
cit = collections.Counter(d for x in N for d in set(x.get("citations", [])))

out = {"questions_version": Q.get("version", ""), "accuracy": acc, "recommend": rec, "citations": cit.most_common(30)}
json.dump(out, open(os.path.join(C["_dir"], "geo-probe.json"), "w"), ensure_ascii=False, indent=1)
print(f"AI 介绍准确：{acc['ok']}/{acc['n']}，按引擎 {dict(by_eng)}，错误 {len(acc['errors'])} 条")
print(f"推荐（干净样本）：{rec['recommended']}/{rec['n_clean']}" + ("" if clean else "，无干净样本 → 推荐率不用实测数据"))
