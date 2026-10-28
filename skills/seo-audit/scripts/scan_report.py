#!/usr/bin/env python3
"""交付前扫描：把报告 HTML 去标签抽成纯文本，按客户版规则查禁用词，命中必须清零才能交付。

用法：python3 scan_report.py --config full/audit.json --html <报告.html>
规则（来自客户反馈，别删）：
  · 任何模式都清零：第三方工具与数据商名、旧出具方名（issuer.former_names）、内部系统名、英文缩写、
    数据局限与过程说明（撞名、样本很小、已测权重……）、账号与额度、「前 10」（统一写「第一页」）、残留占位符
  · 诊断模式（report.mode = diagnosis）另外清零方案类词：修改单、改写稿、人日、排期、负责方、验收、改完后……
  · 「逐条看」的词只打印上下文，不判失败
  · 出具方名（issuer.name）必须出现
  · 中文 AI 腔与语体规则（zh_rules.py，51 条，带来源）：must 级清零，look 级打印上下文；report.allow_terms 放行客户品牌词与引用原文
  · 中英文排版（autocorrect-py，只提示不拦；未安装时跳过，pip install autocorrect-py）
退出码：0 = 可交付，1 = 有必须清零的命中。
"""
import argparse, html, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cfg
import zh_rules

ALWAYS = ["Semrush", "semrush", "Authority Score", "Ahrefs", "DataForSEO", "Moz ", "SerpApi", "SerpAPI", "Serper",
          "鲲鹏", "MCP", "GSC", "SERP", "CWV", "PSI", "CrUX", "Lighthouse",
          "撞名", "样本很小", "样本小", "被抬高", "已测权重", "已测部分", "未覆盖的层", "默认折叠", "没有采集", "缺数据",
          "额度", "临时聊天", "无痕", "记忆", "只能推测", "只能说明", "多半"]
ALWAYS_RX = [r"前 ?10(?![0-9])"]  # 「前 10」统一写「第一页」；「前 100」不算
PLAN = ["修改单", "改写稿", "人日", "排期", "负责方", "验收", "改完后", "确认人", "常见问题"]
LOOK = ["建议", "周", "阶段", "优先级", "目标", "所有", "都是", "推断", "可能", "账号", "未覆盖"]  # 「不是…而是」「？」等句式由 zh_rules 判


ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True); ap.add_argument("--html", required=True)
ap.add_argument("--quiet", action="store_true", help="只打印必须清零项与结论")
a = ap.parse_args()
C = _cfg.load(a.config)
iss = C.get("issuer", {})
if isinstance(iss, str): iss = {"name": iss}  # v2 配置是字符串
R = C.get("report", {})
mode = R.get("mode", "diagnosis")
raw = open(a.html, encoding="utf-8").read()
lines, heads = zh_rules.text_lines(raw)
fail = 0


def hits(words):
    for w in words:
        for i, l in enumerate(lines):
            if w in l: yield w, i, l


must = ALWAYS + list(iss.get("former_names", [])) + list(R.get("banned_terms", [])) + (PLAN if mode == "diagnosis" else [])
for w, i, l in hits(must):
    fail += 1; print(f"[必须清零] {w}｜{l[:120]}")
for rx in ALWAYS_RX:
    for l in lines:
        if re.search(rx, l): fail += 1; print(f"[必须清零] 前 10｜{l[:120]}")
left = sorted(set(re.findall(r"\{[A-Z]+SEC\}", raw)))
if left: fail += 1; print(f"[必须清零] 残留占位符 {left}")
if iss.get("name") and iss["name"] not in raw: fail += 1; print(f"[必须清零] 全文没有出具方「{iss['name']}」")

found, k = zh_rules.check(*zh_rules.text_lines(raw, skip_quote=True), allow=R.get("allow_terms", []))  # 工具名等净化项仍查全文
for i, lv, note, frag in found:
    if lv == "must": fail += 1; print(f"[必须清零] {i} {note}｜{frag}")
if not a.quiet:
    seen = {}
    for i, lv, note, frag in found:
        if lv == "look":
            seen[i] = seen.get(i, 0) + 1
            if seen[i] <= 3: print(f"[逐条看] {i} {note}｜{frag}")
    for w, i, l in hits(LOOK):
        seen[w] = seen.get(w, 0) + 1
        if seen[w] <= 3: print(f"[逐条看] {w}｜{l[:100]}")

try:
    import autocorrect_py
    # 只提示不拦：报告里大量引用搜索词与网站原标题，必须保持原样；英文清单里的顿号也不该改成逗号
    ac = autocorrect_py.lint_for(raw, "html").lines
    if not a.quiet:
        for ln in ac[:10]: print(f"[逐条看] 排版 第 {ln.line} 行｜{ln.old.strip()[:60]} → {ln.new.strip()[:60]}")
    if ac: print(f"[提示] 排版建议 {len(ac)} 处（自己写的正文要改；引用原文不改）")
except ImportError:
    print("[提示] 未安装 autocorrect-py，中英文排版检查跳过（pip install autocorrect-py）")

print(f"模式 {mode}，纯文本 {len(lines)} 行、{k:.1f} 千汉字；必须清零命中 {fail} 处" + ("，可交付" if not fail else "，不可交付"))
sys.exit(1 if fail else 0)
