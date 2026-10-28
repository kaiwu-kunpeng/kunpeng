#!/usr/bin/env python3
"""专业度评分表的确定性部分（references/pro-rubric.md）：算好交给终审 agent，终审不得推翻。

用法：python3 pro_metrics.py --config full/audit.json --html <报告.html> [--claims full/claims.json]
输出 <报告>.metrics.json 并打印摘要。门 G1 / G2 / G4 由本脚本判；G3 读 claims.json（没有则记 null）。
"""
import argparse, json, os, re, statistics, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import zh_rules

ABBR = ["GSC", "SERP", "CWV", "PSI", "CrUX", "CTR", "KPI", "ROI"]

ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True); ap.add_argument("--html", required=True); ap.add_argument("--claims")
a = ap.parse_args()
raw = open(a.html, encoding="utf-8").read()


def run(script, *extra):
    r = subprocess.run([sys.executable, "-B", os.path.join(HERE, script), "--config", a.config, "--html", a.html, *extra],
                       capture_output=True, text=True, timeout=300)
    return r.returncode, r.stdout


g1, _ = run("scan_report.py", "--quiet")
_, ng = run("number_gate.py")
m = re.search(r"已登记 ([\d,]+)，未登记 ([\d,]+)，覆盖率 ([\d.]+)%", ng)
reg, loose, cov = (int(m.group(1).replace(",", "")), int(m.group(2).replace(",", "")), float(m.group(3)) / 100) if m else (0, 0, 0.0)
cfg = json.load(open(a.config))
enforce = cfg.get("report", {}).get("number_gate") == "enforce"

lines, heads = zh_rules.text_lines(raw, skip_quote=True)
found, k = zh_rules.check(lines, heads, allow=cfg.get("report", {}).get("allow_terms", []))
masked = "\n".join(zh_rules.mask(l) for l in lines)
sents = [s for s in re.split(r"[。！？；\n]", masked) if re.search(r"[一-鿿]", s)]
slen = sorted(len(re.findall(r"[一-鿿]", s)) for s in sents)
p90 = slen[int(len(slen) * 0.9) - 1] if slen else 0
body_txt = re.sub(r"<[^>]+>", "", re.sub(r"(?is)<(script|style)\b.*?</\1>", "", raw))
bold_txt = "".join(re.sub(r"<[^>]+>", "", b) for b in re.findall(r"(?is)<(?:b|strong)\b[^>]*>(.*?)</(?:b|strong)>", raw))
abbr = {w: len(re.findall(rf"(?<![A-Za-z]){w}(?![A-Za-z])", masked)) for w in ABBR}
quant = len(re.findall(r"所有|全部|都|均", masked))

# 结论节：第一个 h2 到第二个 h2 之间的 li
h2 = [mm.start() for mm in re.finditer(r"(?i)<h2\b", raw)]
concl = raw[h2[0]:h2[1]] if len(h2) >= 2 else ""
lis = re.findall(r"(?is)<li\b[^>]*>(.*?)</li>", concl)
li_ok = sum(1 for li in lis if re.match(r"\s*<(b|strong)\b", li) and re.search(r"\d", re.sub(r"<[^>]+>", "", li)))
concl_chars = len(re.findall(r"[一-鿿]", re.sub(r"<[^>]+>", "", concl)))

claims = None
if a.claims and os.path.exists(a.claims):
    cl = json.load(open(a.claims)); claims = {"n": len(cl), "failed": [c["id"] for c in cl if not c["ok"]]}
placeholders = sorted(set(re.findall(r"\{[A-Z]+SEC\}", raw)))

out = {
    "gates": {"G1_scan": g1 == 0, "G2_numbers": (loose == 0) if enforce else None, "G3_claims": (not claims["failed"]) if claims else None,
              "G4_structure": not placeholders},
    "D1": {"ledger_registered": reg, "ledger_unregistered": loose, "ledger_coverage": round(cov, 4)},
    "D2": {"quantifier_per_k": round(quant / k, 2)},
    "D3": {"conclusion_points": len(lis), "points_bold_with_number": li_ok, "points_in_range": 5 <= len(lis) <= 7},
    "D5": {"ai_must": sum(1 for f in found if f[1] == "must"), "ai_look_per_k": round(sum(1 for f in found if f[1] == "look") / k, 2),
           "question_marks": len(re.findall(r"[？?]", masked)), "sentence_p90": p90, "sentence_p90_ok": p90 <= 60,
           "bold_share": round(len(bold_txt) / max(1, len(body_txt)), 4), "abbr_unexplained": {w: n for w, n in abbr.items() if n}},
    "D6": {"conclusion_chars": concl_chars, "conclusion_short": concl_chars <= 1200},
    "chars_k": round(k, 1),
}
dst = os.path.splitext(a.html)[0] + ".metrics.json"
json.dump(out, open(dst, "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
