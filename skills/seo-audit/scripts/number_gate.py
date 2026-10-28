#!/usr/bin/env python3
"""数字门：报告正文里的每个数字都要有来源——经 g_core.N() 登记（<span data-k>），或命中白名单。

用法：python3 number_gate.py --config full/audit.json --html <报告.html>
白名单（不算未登记）：建议与检查编号（TEC-01）、节号「第 NN 节 / 共 NN 节」、日期、年份、报告编号，以及配置 report.number_whitelist 里的正则
（型号、功率、版本号这类写在原文里的数字；白名单写宽了门就形同虚设，改动要记进 pitfalls）。
配置 report.number_gate：
  "report"（默认）只报覆盖率与未登记数字前 30 个，退出码 0——用于还没改用 N() 的旧生成器
  "enforce" 有任何未登记数字即退出码 1
另查：同一个值登记在多个键下（可能两个变量指同一件事），只提示。
与已登记数字同值的未包裹数字（封面分数、重复引用）算按值可追溯；图表 <svg> 内的数值不计（charts.py 从数据结构生成）；带 data-quote 的原始数据表不计。
"""
import argparse, collections, html, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg

NUM = re.compile(r"(?<![A-Za-z\d])\d[\d,]*(?:\.\d+)?")
BASE_WL = [r"/\s?100\b", r"满分\s?100", r"第\s?[\d–-]+\s?周", r"\b[A-Z]{2,5}-\d{1,3}\b", r"第\s?\d+\s?节", r"共\s?\d+\s?节", r"\d{4}-\d{2}-\d{2}", r"\b20\d{2}\b", r"\d{1,2}\s?月\s?\d{1,2}\s?日"]

ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True); ap.add_argument("--html", required=True)
a = ap.parse_args()
C = _cfg.load(a.config)
R = C.get("report", {})
raw = open(a.html, encoding="utf-8").read()
raw = re.sub(r"(?is)<(script|style|svg)\b.*?</\1>", " ", raw)  # svg：图表数值由 charts.py 从数据结构生成，不手写
raw = re.sub(r"(?is)<table\b[^>]*\bdata-quote\b.*?</table>", " ", raw)  # data-quote：原始数据表（客户原文、URL 清单），不是报告陈述
keys = collections.defaultdict(set)
for k, v in re.findall(r'<span data-k="([^"]+)">([^<]*)</span>', raw): keys[v].add(k)
reg = len(re.findall(r'<span data-k="[^"]+">[^<]*</span>', raw))
text = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r'<span data-k="[^"]+">[^<]*</span>', " 〔登〕 ", raw)))
wl = ([re.escape(R["rid"]) + r"[\w-]*"] if R.get("rid") else []) + BASE_WL + list(R.get("number_whitelist", []))  # 报告编号先于年份规则
for rx in wl: text = re.sub(rx, " 〔白〕 ", text)
loose_all = NUM.findall(text)
by_value = [v for v in loose_all if v in keys]   # 与已登记数字同值（封面分数、重复引用）：按值可追溯
loose = [v for v in loose_all if v not in keys]
tot = reg + len(loose_all)
cov = (reg + len(by_value)) / tot if tot else 1.0
mode = R.get("number_gate", "report")
print(f"数字 {tot:,} 个：已登记 {reg:,}，按值可追溯 {len(by_value):,}，未登记 {len(loose):,}，覆盖率 {cov:.1%}（模式 {mode}）")
for v, n in collections.Counter(loose).most_common(30): print(f"[未登记] {v} ×{n}")
for v, ks in keys.items():
    if len(ks) > 1: print(f"[提示] 同值多键 {v}：{sorted(ks)}")
sys.exit(1 if mode == "enforce" and loose else 0)
