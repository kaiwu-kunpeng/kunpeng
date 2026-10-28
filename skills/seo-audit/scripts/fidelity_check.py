#!/usr/bin/env python3
"""改稿保真闸：语言审查 / 去 AI 腔改稿之后，确定性比对改前改后，防止改坏数据。

用法：python3 fidelity_check.py --before <改前.html> --after <改后.html> [--min-retention 0.85]
判定（任一不满足即退出码 1，拒收改稿）：
  · 数字（含千分位、小数、百分比、单位前的数）多重集合完全一致
  · 域名、网址多重集合完全一致
  · 标题序列一致；每张表的行数一致
  · 汉字留存率 ≥ min-retention（防止为了去 AI 腔整段删掉）
思路来源：MrGeDiao/shuorenhua hard_metrics.py（MIT）、op7418/Humanizer-zh check_structure.py（MIT）。
"""
import argparse, collections, html, re, sys

NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?%?")
DOM = re.compile(r"\b(?:[a-z0-9-]+\.)+(?:com|net|org|de|nl|es|it|fr|pl|cz|au|uk|io|cn|jp|th|pk|hk|info|eu|store|co)\b(?:/[\w./-]*)?", re.I)


def parts(raw):
    raw = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", raw)
    heads = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", h))).strip() for h in re.findall(r"(?is)<h[1-4][^>]*>(.*?)</h[1-4]>", raw)]
    rows = [len(re.findall(r"(?i)<tr\b", t)) for t in re.findall(r"(?is)<table\b.*?</table>", raw)]
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return text, heads, rows


def diff(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return dict(ca - cb), dict(cb - ca)


ap = argparse.ArgumentParser()
ap.add_argument("--before", required=True); ap.add_argument("--after", required=True)
ap.add_argument("--min-retention", type=float, default=0.85)
a = ap.parse_args()
ta, ha, ra = parts(open(a.before, encoding="utf-8").read())
tb, hb, rb = parts(open(a.after, encoding="utf-8").read())
bad = []
lost, added = diff(NUM.findall(ta), NUM.findall(tb))
if lost or added: bad.append(f"数字不一致：改后少了 {lost or '无'}，多了 {added or '无'}")
lost, added = diff([d.lower() for d in DOM.findall(ta)], [d.lower() for d in DOM.findall(tb)])
if lost or added: bad.append(f"域名不一致：少了 {lost or '无'}，多了 {added or '无'}")
if ha != hb: bad.append(f"标题变了：{[h for h in ha if h not in hb][:5]} → {[h for h in hb if h not in ha][:5]}")
if ra != rb: bad.append(f"表格行数变了：{ra} → {rb}")
za, zb = len(re.findall(r"[一-鿿]", ta)), len(re.findall(r"[一-鿿]", tb))
ret = zb / za if za else 1
if ret < a.min_retention: bad.append(f"汉字留存 {ret:.1%} 低于 {a.min_retention:.0%}")
for b in bad: print(f"[拒收] {b}")
print(f"汉字 {za:,} → {zb:,}（留存 {ret:.1%}）；" + ("保真，可接收改稿" if not bad else f"{len(bad)} 项不保真，拒收改稿"))
sys.exit(1 if bad else 0)
