# -*- coding: utf-8 -*-
"""高管摘要版（edition = brief）：给客户老板看，8–12 页，结论先行，问题与改进突出。

数据契约（字典 D，生成器从完整诊断版的同一数据层取值；数字经 g_core.N 输出，判断句经 claims.claim 校验）：
  title, subtitle, site, client, date, rid, issuer, mode（diagnosis / plan）, full_link（完整诊断版地址，可空）
  scores    {"seo": int, "geo": int, "composite": int}
  summary   {"situation": 现状一句, "complication": 问题一句, "answer": [三到五条结论]}           # SCQA 执行摘要
  findings  [{"title": 结论式标题, "value": 大数字, "unit": 单位, "detail": 一句依据, "band": ok/wa/dg}]  # 恰好 3 条
  issues    [{"sev": "dg"/"wa", "title": 问题（一句判断）, "scope": 影响范围（带数字）, "impact": 业务后果,
              "evidence": 依据, "fix": 建议编号（仅 plan 模式显示，可空）}]                        # 4–8 条，按严重度排
  dims      [(分项名, 得分率 0–100, 参照 0–100 或 None)]；分项名以「§」开头的是组标题行          # 评分子弹图
  markets   {"cols": [列名], "rows": [(市场, [0–1 或 None])], "caption": 图注}                    # 可选，热力格
  compare   {"title", "caption", "rows": [(指标, 本站, 参照)], "a_label", "b_label"}             # 可选，哑铃图
  uplift    [(分项名, 现在 0–100, 改完后 0–100)]                                                  # 仅 plan，分数提升
  improvements [{"id", "title": 改进项（做法）, "problem": 现状, "effect": 预期效果, "done": 完成标准, "owner", "when"}]  # 仅 plan，≤ 6 条
  actions   [{"id", "name", "impact_band": 0 高/1 中/2 低, "effort_band": 0 低/1 中/2 高, "owner", "when"}]  # 仅 plan，九宫格
  scope     数据范围一句话
版式规则：每节标题是一句完整判断（不是「技术」「速度」这类名词）；表最多 6 行，超了在渲染前报错。
诊断模式只写问题与影响，不出现 uplift / improvements / actions / fix。
"""
import g_core as C
import charts as G

MAX_ROWS = 6
SEV = {"dg": ("严重", "mk-dg"), "wa": ("较重", "mk-wa")}


def _check(D):
    need = ["title", "site", "client", "date", "rid", "issuer", "scores", "summary", "findings", "issues", "dims", "scope"]
    miss = [k for k in need if k not in D]
    if miss: raise SystemExit(f"高管摘要版缺字段：{miss}")
    if len(D["findings"]) != 3: raise SystemExit(f"高管摘要版的发现必须恰好 3 条，现在 {len(D['findings'])} 条")
    if not 4 <= len(D["issues"]) <= 8: raise SystemExit(f"主要问题须 4–8 条，现在 {len(D['issues'])} 条")
    if any(i["sev"] not in SEV for i in D["issues"]): raise SystemExit("问题严重度只能是 dg（严重）或 wa（较重）")
    sev = [i["sev"] for i in D["issues"]]
    if sev != sorted(sev, key=lambda x: x != "dg"): raise SystemExit("主要问题须按严重度排列（严重在前）")
    if D.get("mode") != "plan":
        extra = [k for k in ("uplift", "improvements", "actions") if D.get(k)] + (["issues.fix"] if any(i.get("fix") for i in D["issues"]) else [])
        if extra: raise SystemExit(f"诊断模式不放方案内容：{extra}（切 plan 模式或删掉）")
    if len(D.get("improvements", [])) > MAX_ROWS: raise SystemExit("改进重点最多 6 条")


def render(D, section_titles):
    """section_titles：各节的结论式标题，键 summary / findings / issues / scores / markets / compare / uplift / improvements / actions / scope。"""
    _check(D)
    plan = D.get("mode") == "plan"
    s = D["scores"]
    C.begin("full", narrow=True, name="高管摘要")
    C.cover("高管摘要", "EXECUTIVE BRIEF", D["title"], [D["site"], D["client"], D["date"]], D["rid"], sub=D.get("subtitle", ""),
            right_lines=[f"出具：{D['issuer']}"], scores=[("SEO", s["seo"], C.grade(s["seo"])), ("GEO", s["geo"], C.grade(s["geo"]))],
            ringv=(s["composite"], "综合"))
    sm = D["summary"]
    C.h2(section_titles["summary"])
    C.w('<div class="scqa"><div><b>现状</b><p>' + sm["situation"] + '</p></div><div><b>问题</b><p>' + sm["complication"] +
        '</p></div><div class="ans"><b>结论</b><ol>' + "".join(f"<li>{a}</li>" for a in sm["answer"]) + "</ol></div></div>")
    C.h2(section_titles["findings"])
    C.w('<div class="fcards">' + "".join(
        f'<div class="fcard {f.get("band", "")}"><div class="fv">{f["value"]}<small>{f.get("unit", "")}</small></div>'
        f'<div class="ft">{f["title"]}</div><div class="fd">{f["detail"]}</div></div>' for f in D["findings"]) + "</div>")

    C.h2(section_titles["issues"])
    rows = []
    for k, i in enumerate(D["issues"], 1):
        lab, cls = SEV[i["sev"]]
        fix = f'<div class="ifix">对应改进：{i["fix"]}</div>' if plan and i.get("fix") else ""
        rows.append(f'<div class="issue {i["sev"]}"><div class="ino">{C.N(k, f"issue.no.{k}", "02d")}</div><div class="ibody">'
                    f'<div class="ihead"><span class="mk {cls}"></span><span class="isev">{lab}</span><b>{i["title"]}</b></div>'
                    f'<div class="igrid"><div><em class="lb">影响范围</em>{i["scope"]}</div><div><em class="lb">业务后果</em>{i["impact"]}</div>'
                    f'<div><em class="lb">依据</em>{i["evidence"]}</div></div>{fix}</div></div>')
    C.w('<div class="issues">' + "".join(rows) + "</div>")

    C.h2(section_titles["scores"])
    C.w(C.scale_legend())
    C.w(G.bullet(D["dims"], "分项得分率", "各分项得分率（满分 100）", ref_label=D.get("dims_ref_label", "参照")))
    if D.get("markets"):
        mk = D["markets"]
        C.h2(section_titles["markets"])
        C.w(G.heatgrid(mk["cols"], mk["rows"], "各市场表现", mk.get("caption", "")))
    if D.get("compare"):
        cp = D["compare"]
        if len(cp["rows"]) > MAX_ROWS: raise SystemExit("对比图超过 6 行")
        C.h2(section_titles["compare"])
        C.w(G.dumbbell(cp["rows"], cp["title"], cp.get("caption", ""), cp.get("a_label", "本站"), cp.get("b_label", "竞品中位数")))
    if plan and D.get("uplift"):
        C.h2(section_titles["uplift"])
        C.w(G.dumbbell([(n, after, now) for n, now, after in D["uplift"]], "全部改完后的分项得分率",
                       "实心点为全部改完后，空心点为现在；只计方案明确覆盖的检查项", "全部改完后", "现在", vmax=100))
    if plan and D.get("improvements"):
        C.h2(section_titles["improvements"])
        C.w('<div class="imps">' + "".join(
            f'<div class="imp"><div class="iid">{m["id"]}</div><div class="ibody"><b>{m["title"]}</b>'
            f'<div class="iflow"><div><em class="lb">现状</em>{m["problem"]}</div><div class="eff"><em class="lb">预期效果</em>{m["effect"]}</div>'
            f'<div><em class="lb">完成标准</em>{m["done"]}</div></div>'
            f'<div class="imeta">{m["owner"]} · {m["when"]}</div></div></div>' for m in D["improvements"]) + "</div>")
    if plan and D.get("actions"):
        acts = D["actions"]
        C.h2(section_titles["actions"])
        C.w(G.matrix3x3([(a["id"], a["effort_band"], a["impact_band"]) for a in acts], "影响与投入", "左上格为影响大、投入小的优先项"))
        top = sorted(acts, key=lambda a: (a["impact_band"], a["effort_band"]))[:5]
        C.T(["编号", "行动", "负责方", "时间"], [[a["id"], a["name"], a["owner"], a["when"]] for a in top])
    C.h2(section_titles["scope"])
    C.p(D["scope"] + (f'完整诊断见 <a href="{D["full_link"]}">{D["full_link"]}</a>。' if D.get("full_link") else ""))
    C.foot(f"{D['issuer']} · 高管摘要", D["rid"])
    C.end()
