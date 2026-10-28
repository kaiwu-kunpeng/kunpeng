# -*- coding: utf-8 -*-
"""方案执行版（edition = playbook）：方案模式的执行材料，讲清谁、在什么时间、做什么、做到什么程度。不写价格。

数据契约（字典 P；生成器从同一数据层取值，正文里的数字建议经 g_core.N 输出）：
  title, subtitle, site, client, date, rid, issuer, mode（必须 plan）, full_link（完整诊断版地址，可空）
  start       第 1 周周一（datetime.date）；weeks 总周数（int）
  scores      {"seo": (现值, 目标), "geo": (现值, 目标), "composite": (现值, 目标)}          # 封面
  lead        导语一段；kpis [(标签, 值, 说明, ok/wa/dg/in/'')]                           # 计划概览
  targets     [(检查项或分项, 现值 0–100, 目标 0–100)]                                    # 目标子弹图，按差距由大到小排
  lanes       [(工作线名, 语义令牌名)]，令牌用 "series-1"…"series-6"（不用状态色 ok/wa/dg）
  tasks       [{"id", "name", "lane", "weeks": [int], "owner": 负责方文字, "parties": [方键], "days": 人日,
               "work": 这几周做什么, "accept": 验收标准, "prio": "高/中/低"}]                # 每项行动恰好一行
  checkpoints [{"name", "weeks": [int], "what"}]                                          # 甘特末尾的节点行
  months      [{"name", "lo", "hi", "goal"}]                                              # 分月工作表
  parties     [(显示名, 方键)]                                                            # 负责矩阵列
  gates       [{"name", "week": int, "scope", "criteria"}]                                # 验收节点时间线
  tracking    {"head": [...], "rows": [[...]]}（可空）                                    # 竞品跟踪
  confirm     [(事项, 原因, 涉及编号)]；risks [(风险, 应对)]；scope 数据与口径一句话
section_titles：键 overview / targets / roadmap / months / raci / gates / tracking / confirm / risks / scope，每个标题是一句完整判断。
版式规则：甘特图为纯 SVG（零 JS），打印时走横向页；色值只用 var(--*)；工作量按「人日 ÷ 参与方数 × 落在该月的周数 ÷ 总周数」分摊，各方相加等于总量。
"""
import datetime as _dt
import html as _h
import re
import g_core as C


def _plain(t): return _h.unescape(re.sub(r"<[^>]+>", "", str(t)))


def _h2(t):
    """节标题可含数字账本标签；目录（侧栏与打印目录）只要纯文本。"""
    C.h2(t)
    hid, _ = C.TOC[-1]; C.TOC[-1] = (hid, _plain(t))


def _e(t): return _h.escape(str(t))


def _txt(x, y, t, anchor="start", fill="var(--tx2)", weight=400, size=12):
    return f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" style="fill:{fill};font-weight:{weight};font-size:{size}px">{_e(t)}</text>'


def _check(P):
    need = ["title", "site", "client", "date", "rid", "issuer", "start", "weeks", "scores", "lead", "targets", "lanes", "tasks",
            "checkpoints", "months", "parties", "gates", "confirm", "risks", "scope"]
    miss = [k for k in need if k not in P]
    if miss: raise SystemExit(f"方案执行版缺字段：{miss}")
    if P.get("mode") != "plan": raise SystemExit("方案执行版只用于方案模式（mode = plan）")
    ids = [t["id"] for t in P["tasks"]]
    if len(ids) != len(set(ids)): raise SystemExit("行动编号重复")
    lanes = {n for n, _ in P["lanes"]}
    bad = [t["id"] for t in P["tasks"] if t["lane"] not in lanes or not t["weeks"] or not all(1 <= w <= P["weeks"] for w in t["weeks"])]
    if bad: raise SystemExit(f"行动的工作线或周次不合法：{bad}")
    if any(k in ("ok", "wa", "dg") for _, k in P["lanes"]): raise SystemExit("工作线颜色不用状态色")


def week_range(P, i):
    a = P["start"] + _dt.timedelta(weeks=i - 1)
    return a, a + _dt.timedelta(days=6)


def _md(d): return f"{d.month}/{d.day}"


def _wd(P, i, end=False):
    """周的起止日期，登记进数字账本（键 wk<i>.s / wk<i>.e）。"""
    d = week_range(P, i)[1 if end else 0]
    return C.N(_md(d), f"wk{i}.{'e' if end else 's'}", "")


def _wtxt(ws):
    ws = sorted(ws)
    if len(ws) == 1: return f"W{ws[0]}"
    if ws == list(range(ws[0], ws[-1] + 1)): return f"W{ws[0]}–{ws[-1]}"
    return "、".join(f"W{w}" for w in ws)


def gantt_svg(P):
    """按周的甘特图：每行一个行动（同行分开的色块 = 分步执行），末尾是节点行（菱形）。"""
    NW = P["weeks"]; lw, cw, rh, top = 300, 54, 22, 52
    w = lw + cw * NW + 10
    rows = sorted(P["tasks"], key=lambda t: (min(t["weeks"]), max(t["weeks"]), t["id"]))
    h = top + rh * (len(rows) + len(P["checkpoints"])) + 14
    tok = dict(P["lanes"])
    out = []
    for m in P["months"]:
        x0, x1 = lw + cw * (m["lo"] - 1), lw + cw * m["hi"]
        out.append(f'<rect x="{x0 + 1}" y="2" width="{x1 - x0 - 2}" height="20" rx="3" style="fill:var(--sf2);stroke:var(--ln)"/>')
        out.append(_txt((x0 + x1) / 2, 16, f'{m["name"]} · {_md(week_range(P, m["lo"])[0])}–{_md(week_range(P, m["hi"])[1])}', "middle", "var(--tx)", 600, 11))
    for i in range(1, NW + 1):
        x = lw + cw * (i - 1)
        out.append(_txt(x + cw / 2, 36, f"W{i}", "middle", "var(--tx)", 600, 11))
        out.append(_txt(x + cw / 2, 48, _md(week_range(P, i)[0]), "middle", "var(--mu)", 400, 9.5))
        out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top - 2}" y2="{h - 10}" style="stroke:var(--ln);stroke-dasharray:2 3"/>')
    for r, t in enumerate(rows):
        y = top + rh * r
        if r % 2: out.append(f'<rect x="0" y="{y}" width="{w}" height="{rh}" style="fill:var(--row-alt)"/>')
        nm = _plain(t["name"]); name = nm if len(nm) <= 17 else nm[:16] + "…"
        out.append(_txt(4, y + 15, t["id"], fill="var(--tx)", weight=600, size=11) + _txt(64, y + 15, name, size=11))
        ws = sorted(t["weeks"]); seg = [[ws[0], ws[0]]]
        for wk in ws[1:]:
            if wk == seg[-1][1] + 1: seg[-1][1] = wk
            else: seg.append([wk, wk])
        for a, b in seg:
            out.append(f'<rect x="{lw + cw * (a - 1) + 3}" y="{y + 5}" width="{cw * (b - a + 1) - 6}" height="{rh - 10}" rx="3" style="fill:var(--{tok[t["lane"]]})"><title>{_e(t["id"])} {_e(_wtxt(t["weeks"]))}</title></rect>')
    for k, c in enumerate(P["checkpoints"]):
        y = top + rh * (len(rows) + k)
        out.append(f'<rect x="0" y="{y}" width="{w}" height="{rh}" style="fill:var(--sf2)"/>')
        out.append(_txt(4, y + 15, c["name"], fill="var(--tx)", weight=700, size=11))
        for wk in c["weeks"]:
            cx, cy = lw + cw * (wk - 1) + cw / 2, y + rh / 2
            out.append(f'<path d="M{cx:.1f} {cy - 7:.1f} L{cx + 7:.1f} {cy:.1f} L{cx:.1f} {cy + 7:.1f} L{cx - 7:.1f} {cy:.1f} Z" style="fill:var(--ink)"/>')
    legend = "".join(f'<span><i style="background:var(--{k})"></i>{_e(n)}</span>' for n, k in P["lanes"]) + '<span><i class="dia"></i>节点</span>'
    return (f'<div class="pb-legend">{legend}</div><div class="pb-scroll wide"><figure class="chart"><svg class="svg pb-gantt" viewBox="0 0 {w} {h}" role="img" '
            f'aria-label="路线图" style="font:12px var(--font-sans);min-width:{w * 0.72:.0f}px"><title>路线图</title>{"".join(out)}</svg>'
            '<figcaption class="mu">每行一项行动，同一行中分开的色块表示分步执行；菱形为验收与复测节点。</figcaption></figure></div>')


def targets_svg(rows):
    """现值 → 目标：灰条为现值，强调色段为计划提升，竖线为目标。"""
    w, lw, rh = 720, 230, 30; h = rh * len(rows) + 30; x0, x1 = lw, w - 96
    sc = lambda v: x0 + (x1 - x0) * max(0, min(v, 100)) / 100
    out = [f'<line x1="{sc(t):.1f}" x2="{sc(t):.1f}" y1="6" y2="{h - 22}" style="stroke:var(--ln)"/>' + _txt(sc(t), h - 8, t, "middle", "var(--mu)", size=10) for t in (0, 25, 50, 75, 100)]
    for i, (name, now, tgt) in enumerate(rows):
        y = 8 + i * rh
        out.append(_txt(0, y + 14, name if len(name) <= 19 else name[:18] + "…"))
        out.append(f'<rect x="{x0}" y="{y + 4}" width="{x1 - x0}" height="12" style="fill:var(--sf2)"/>')
        out.append(f'<rect x="{x0}" y="{y + 4}" width="{sc(now) - x0:.1f}" height="12" style="fill:var(--ln2)"/>')
        if tgt > now: out.append(f'<rect x="{sc(now):.1f}" y="{y + 4}" width="{sc(tgt) - sc(now):.1f}" height="12" style="fill:var(--ac)"/>')
        out.append(f'<line x1="{sc(tgt):.1f}" x2="{sc(tgt):.1f}" y1="{y}" y2="{y + 20}" style="stroke:var(--tx);stroke-width:2"/>')
        out.append(_txt(x1 + 8, y + 14, f"{now:g} → {tgt:g}", fill="var(--tx)", weight=600))
    return (f'<figure class="chart"><svg class="svg" viewBox="0 0 {w} {h}" role="img" aria-label="现值与目标" style="font:12px var(--font-sans);max-width:{w}px">'
            f'<title>现值与目标</title>{"".join(out)}</svg><figcaption class="mu">灰色为现值，强调色为计划提升部分，竖线为目标值（得分率，满分 100）。</figcaption></figure>')


def effort(P):
    """各方每月工作量（人日）：每项按参与方平均拆分，再按落在各月的周数分摊。返回 {方键: [各月]}。"""
    out = {k: [0.0] * len(P["months"]) for _, k in P["parties"]}
    for t in P["tasks"]:
        ps = [k for k in t["parties"] if k in out]
        for k in ps:
            for j, m in enumerate(P["months"]):
                out[k][j] += t["days"] / len(ps) * sum(1 for w in t["weeks"] if m["lo"] <= w <= m["hi"]) / len(t["weeks"])
    return out


def render(P, section_titles):
    _check(P)
    T = section_titles; s = P["scores"]
    C.begin("full", name="方案执行")
    C.cover("方案执行", "EXECUTION PLAYBOOK", P["title"], [P["site"], P["client"], P["date"]], P["rid"],
            [f"出具：{P['issuer']}", f"周期：{_wd(P, 1)} 起 {C.N(P['weeks'], 'weeks')} 周"], sub=P.get("subtitle", ""),
            scores=[("SEO 目标", s["seo"][1], C.grade(s["seo"][1])), ("GEO 目标", s["geo"][1], C.grade(s["geo"][1]))],
            ringv=(s["composite"][1], "综合目标"))

    _h2(T["overview"])
    C.p(P["lead"], "lead")
    C.kpis(P["kpis"])

    _h2(T["targets"])
    C.w(targets_svg(P["targets"]))

    _h2(T["roadmap"])
    C.w(gantt_svg(P))

    _h2(T["months"])
    by = {t["id"]: t for t in P["tasks"]}
    for m in P["months"]:
        items = sorted([t for t in P["tasks"] if any(m["lo"] <= w <= m["hi"] for w in t["weeks"])], key=lambda t: (min(t["weeks"]), t["id"]))
        C.box(f'<b>{m["name"]} · {_wd(P, m["lo"])}–{_wd(P, m["hi"], True)}</b>　{m["goal"]}', k="ac")
        rows = [[C.code(t["id"]), t["name"], t["owner"], _wtxt([w for w in t["weeks"] if m["lo"] <= w <= m["hi"]]), t["work"], t["accept"]] for t in items]
        C.T(["编号", "行动", "负责方", "周", "工作内容", "验收标准"], rows, cls="wrap1 pb-month", colw=["70px", "19%", "96px", "70px", "30%", None])

    _h2(T["raci"])
    eff = effort(P); keys = [k for _, k in P["parties"]]
    rows = []
    for t in sorted(P["tasks"], key=lambda t: (min(t["weeks"]), t["id"])):
        ps = [k for k in t["parties"] if k in keys]
        cell = lambda k: (f'<span class="pb-dot"></span>' if k in ps else '<span class="mu">—</span>')
        rows.append([C.code(t["id"]), t["name"], t.get("prio", "")] + [cell(k) for k in keys] + [C.N(t["days"], f"days.{t['id']}", "g")])
    rows.append(["合计", "", ""] + [C.N(round(sum(eff[k]), 1), f"eff.{k}.sum", ".1f") for k in keys] + [C.N(round(sum(t["days"] for t in P["tasks"]), 1), "days.total", ".1f")])
    C.T(["编号", "行动", "优先级"] + [n for n, _ in P["parties"]] + ["人日"], rows, cls="pb-raci")
    C.h3("各方每月工作量（人日）")
    mrows = [[n] + [C.N(round(eff[k][j], 1), f"eff.{k}.m{j + 1}", ".1f") for j in range(len(P["months"]))] + [C.N(round(sum(eff[k]), 1), f"eff.{k}.sum", ".1f")] for n, k in P["parties"]]
    tot = [sum(eff[k][j] for k in keys) for j in range(len(P["months"]))]
    mrows.append(["合计"] + [C.N(round(v, 1), f"eff.all.m{j + 1}", ".1f") for j, v in enumerate(tot)] + [C.N(round(sum(t["days"] for t in P["tasks"]), 1), "days.total", ".1f")])
    C.T(["负责方"] + [m["name"] for m in P["months"]] + ["合计"], mrows)
    C.p("每项行动的人日按参与方平均拆分，再按落在各月的周数分摊；各方相加等于总量。表中数值四舍五入到一位小数，合计按未取整值计算。", "mu")

    _h2(T["gates"])
    C.w('<div class="tl pb-gates">' + "".join(
        f'<div class="it"><span class="t">W{g["week"]} · {_wd(P, g["week"])}–{_wd(P, g["week"], True)}</span><br><b>{g["name"]}</b>　{g["scope"]}'
        f'<div class="pb-crit">{g["criteria"]}</div></div>' for g in P["gates"]) + "</div>")

    if P.get("tracking"):
        _h2(T["tracking"])
        C.T(P["tracking"]["head"], P["tracking"]["rows"], cls="wrap1")

    _h2(T["confirm"])
    C.T(["事项", "原因", "涉及行动"], [list(r) for r in P["confirm"]], cls="wrap1")
    _h2(T["risks"])
    C.T(["风险", "应对"], [list(r) for r in P["risks"]], cls="wrap1")
    _h2(T["scope"])
    C.p(P["scope"] + (f'完整诊断见 <a href="{P["full_link"]}">{P["full_link"]}</a>。' if P.get("full_link") else ""))
    C.foot(f"{P['issuer']} · 方案执行", P["rid"])
    C.end()
