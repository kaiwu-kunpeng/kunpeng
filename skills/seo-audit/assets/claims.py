# -*- coding: utf-8 -*-
"""判定句断言注册表：「德国、意大利排第一」「大多有出处」这类从数据读出的判断句，先声明校验再渲染。

用法（在正文生成器里）：
    import claims as K
    p(K.claim("rank-first", "AIKO 在{mk}排名第一。", K.set_equals(first_markets, {"de", "it"}),
              refs=["full/external/organic_by_market.json"], mk="德国、意大利"))
check 不通过时 on_fail="exception"（默认）直接停止生成；"warn" 只打印并照常输出。
生成结束调 K.dump("full/claims.json")，审查 agent 把它当「已机器证实」清单，不再重复核对。
写法借鉴 Great Expectations 的 expectation 命名与 Guardrails 的 on_fail（均为 Apache-2.0），未复制代码。
"""
import json

REG = []


def claim(cid, text, check, refs=(), on_fail="exception", **fmt):
    ok, why = check
    REG.append({"id": cid, "text": text.format(**fmt), "ok": ok, "why": why, "refs": list(refs)})
    if not ok:
        msg = f"判定句 {cid} 与数据不符：{why}（{text.format(**fmt)}）"
        if on_fail == "exception": raise AssertionError(msg)
        print(f"[warn] {msg}")
    return text.format(**fmt)


def set_equals(actual, expected):
    a, e = set(actual), set(expected)
    return a == e, f"实际 {sorted(a)}，正文写 {sorted(e)}"


def all_true(values, label="全部"):
    vals = list(values); bad = sum(1 for v in vals if not v)
    return bad == 0 and len(vals) > 0, f"{label}：{len(vals)} 项里 {bad} 项不满足"


def ratio_at_least(num, den, threshold, label="比例"):
    r = num / den if den else 0
    return den > 0 and r >= threshold, f"{label} {num}/{den} = {r:.1%}，要求 ≥ {threshold:.0%}"


def ratio_below(num, den, threshold, label="比例"):
    r = num / den if den else 0
    return den > 0 and r < threshold, f"{label} {num}/{den} = {r:.1%}，要求 < {threshold:.0%}"


def rank_first(scores, who):
    top = max(scores.values()) if scores else None
    return bool(scores) and scores.get(who) == top, f"{who} = {scores.get(who)}，最高 {top}"


def sum_equals(parts, total):
    s = sum(parts)
    return s == total, f"明细合计 {s}，总数 {total}"


def dump(path):
    json.dump(REG, open(path, "w"), ensure_ascii=False, indent=1)
    return len(REG)
