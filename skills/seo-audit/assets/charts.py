# -*- coding: utf-8 -*-
"""纯 SVG 图表：服务端生成、零 JS、零外链，打印与 PDF 完整可读。颜色只用 var(--*) 令牌。

选图按 FT Visual Vocabulary（中文版）的关系分类：排序用 hbar，我方对参照用 bullet / dumbbell，
两维定位用 bubble2x2，市场 × 指标用 heatgrid。默认灰阶，只用一个强调色突出我方（咨询图表惯例）。
每张图返回一段 <figure>，带 role="img"、<title> 与一句图注（结论 + 数据来源）。
"""
import html as _h

GRID = "var(--ln)"; MUTED = "var(--ln2)"; ACC = "var(--ac)"; TX = "var(--tx2)"; MU = "var(--mu)"
BAND = {"ok": "var(--ok)", "wa": "var(--wa)", "dg": "var(--dg)"}


def _e(t): return _h.escape(str(t))


def band(v, ok=70, wa=55):
    return "ok" if v >= ok else "wa" if v >= wa else "dg"


def _fig(svg, title, caption, w, h):
    cap = f'<figcaption class="mu">{caption}</figcaption>' if caption else ""
    return (f'<figure class="chart"><svg class="svg" viewBox="0 0 {w} {h}" role="img" aria-label="{_e(title)}" '
            f'style="font:12px var(--font-sans);max-width:{w}px"><title>{_e(title)}</title>{svg}</svg>{cap}</figure>')


def _txt(x, y, t, anchor="start", fill=TX, weight=400, size=12):
    return f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" style="fill:{fill};font-weight:{weight};font-size:{size}px">{_e(t)}</text>'


def bullet(rows, title, caption="", vmax=100, ref_label="参照"):
    """rows: [(名称, 值, 参照值或 None)]。条 = 值（按分档着色），竖线 = 参照（竞品中位数 / 行业基准）。"""
    w, lw, rh = 640, 132, 30; h = rh * len(rows) + 30; x0, x1 = lw, w - 46
    sc = lambda v: x0 + (x1 - x0) * max(0, min(v, vmax)) / vmax
    out = [f'<line x1="{sc(t):.1f}" x2="{sc(t):.1f}" y1="8" y2="{h - 22}" style="stroke:{GRID}"/>' + _txt(sc(t), h - 8, t, "middle", MU, size=10) for t in range(0, vmax + 1, vmax // 4)]
    for i, (name, v, ref) in enumerate(rows):
        y = 10 + i * rh
        if name.startswith("§"):  # 组标题行
            out.append(_txt(0, y + 16, name[1:], fill="var(--tx)", weight=700, size=12.5)); continue
        out.append(_txt(12, y + 14, name))
        out.append(f'<rect x="{x0}" y="{y + 4}" width="{x1 - x0}" height="12" style="fill:var(--sf2)"/>')
        out.append(f'<rect x="{x0}" y="{y + 4}" width="{sc(v) - x0:.1f}" height="12" style="fill:{BAND[band(v)]}"/>')
        if ref is not None: out.append(f'<line x1="{sc(ref):.1f}" x2="{sc(ref):.1f}" y1="{y}" y2="{y + 20}" style="stroke:var(--tx);stroke-width:2"/>')
        out.append(_txt(x1 + 6, y + 14, f"{v:g}", weight=600))
    return _fig("".join(out), title, caption + (f"（竖线为{ref_label}）" if any(r[2] is not None for r in rows) else ""), w, h)


def hbar(rows, title, caption="", me=None, unit="", vmax=None):
    """rows: [(名称, 值)]，按给定顺序画（排序由调用方决定）；me 是我方名称，用强调色，其余灰。"""
    w, lw, rh = 640, 150, 24; h = rh * len(rows) + 8; vmax = vmax or max(v for _, v in rows) or 1; x0, x1 = lw, w - 70
    out = []
    for i, (name, v) in enumerate(rows):
        y = 4 + i * rh; mine = name == me
        out.append(_txt(0, y + 14, name, weight=600 if mine else 400, fill="var(--tx)" if mine else TX))
        out.append(f'<rect x="{x0}" y="{y + 3}" width="{(x1 - x0) * v / vmax:.1f}" height="14" style="fill:{ACC if mine else MUTED}"/>')
        out.append(_txt(x0 + (x1 - x0) * v / vmax + 6, y + 14, f"{v:,}{unit}", weight=600 if mine else 400))
    return _fig("".join(out), title, caption, w, h)


def dumbbell(rows, title, caption="", a_label="本站", b_label="竞品中位数", vmax=None, unit=""):
    """rows: [(指标, 本站值, 参照值)]。两点连线显示差距，本站点用强调色。"""
    w, lw, rh = 640, 190, 34; h = rh * len(rows) + 44; x0, x1 = lw, w - 30
    vmax = vmax or max(max(a, b) for _, a, b in rows) or 1
    sc = lambda v: x0 + (x1 - x0) * v / vmax
    out = [f'<circle cx="{x0 + 6}" cy="{h - 10}" r="5" style="fill:{ACC}"/>' + _txt(x0 + 16, h - 6, a_label, size=11),
           f'<circle cx="{x0 + 106}" cy="{h - 10}" r="5" style="fill:var(--sf);stroke:var(--tx2);stroke-width:2"/>' + _txt(x0 + 116, h - 6, b_label, size=11)]
    for i, (name, a, b) in enumerate(rows):
        y = 24 + i * rh
        out.append(_txt(0, y + 4, name))
        out.append(f'<line x1="{sc(a):.1f}" x2="{sc(b):.1f}" y1="{y}" y2="{y}" style="stroke:{MUTED};stroke-width:3"/>')
        out.append(f'<circle cx="{sc(b):.1f}" cy="{y}" r="5" style="fill:var(--sf);stroke:var(--tx2);stroke-width:2"/>')
        out.append(f'<circle cx="{sc(a):.1f}" cy="{y}" r="6" style="fill:{ACC}"/>')
        out.append(_txt(sc(a), y - 10, f"{a:,g}{unit}", "middle", "var(--ac)", 700, 11))
        out.append(_txt(sc(b), y + 18, f"{b:,g}{unit}", "middle", MU, 400, 10.5))
    return _fig("".join(out), title, caption, w, h)


def bubble2x2(items, title, caption="", xlab="投入", ylab="影响", quads=("优先做", "规划做", "顺手做", "暂缓")):
    """items: [(标签, x 0–1, y 0–1, 体量)]。四象限：左上 = 投入低影响高。"""
    w, h, p = 560, 380, 40
    sx = lambda x: p + (w - 2 * p) * x; sy = lambda y: h - p - (h - 2 * p) * y
    vmax = max(s for *_, s in items) or 1
    out = [f'<rect x="{p}" y="{p}" width="{(w - 2 * p) / 2}" height="{(h - 2 * p) / 2}" style="fill:var(--ac2)"/>',
           f'<line x1="{w / 2}" x2="{w / 2}" y1="{p}" y2="{h - p}" style="stroke:{GRID}"/>', f'<line x1="{p}" x2="{w - p}" y1="{h / 2}" y2="{h / 2}" style="stroke:{GRID}"/>',
           f'<rect x="{p}" y="{p}" width="{w - 2 * p}" height="{h - 2 * p}" style="fill:none;stroke:{MUTED}"/>',
           _txt(p + 8, p + 18, quads[0], fill=ACC, weight=600), _txt(w - p - 8, p + 18, quads[1], "end", MU), _txt(p + 8, h - p - 8, quads[2], fill=MU), _txt(w - p - 8, h - p - 8, quads[3], "end", MU),
           _txt(w / 2, h - 10, f"{xlab} →", "middle", MU, size=11), f'<text x="14" y="{h / 2}" transform="rotate(-90 14 {h / 2})" text-anchor="middle" style="fill:{MU};font-size:11px">{_e(ylab)} →</text>']
    for lab, x, y, s in items:
        r = 6 + 14 * (s / vmax) ** .5
        out.append(f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="{r:.1f}" style="fill:{ACC};fill-opacity:.75;stroke:var(--sf);stroke-width:1.5"/>')
        out.append(_txt(sx(x) + r + 4, sy(y) + 4, lab, size=11))
    return _fig("".join(out), title, caption, w, h)


def heatgrid(cols, rows, title, caption="", fmt="{:.0%}", ok=.7, wa=.4):
    """cols: 列名；rows: [(行名, [0–1 或 None])]。按分档着浅色底，None 显示「—」。"""
    cw = max(64, 13 * max(len(c) for c in cols) + 16); lw, rh = 120, 26; w = lw + cw * len(cols); h = rh * (len(rows) + 1) + 4
    bg = lambda v: "var(--okb)" if v >= ok else "var(--wab)" if v >= wa else "var(--dgb)"
    fg = lambda v: "var(--ok)" if v >= ok else "var(--wa)" if v >= wa else "var(--dg)"
    out = [_txt(lw + cw * j + cw / 2, 16, c, "middle", MU, 600, 11) for j, c in enumerate(cols)]
    for i, (name, vals) in enumerate(rows):
        y = rh * (i + 1)
        out.append(_txt(0, y + 17, name))
        for j, v in enumerate(vals):
            x = lw + cw * j
            if v is None: out.append(_txt(x + cw / 2, y + 17, "—", "middle", MU)); continue
            out.append(f'<rect x="{x + 1}" y="{y + 1}" width="{cw - 2}" height="{rh - 2}" rx="3" style="fill:{bg(v)}"/>')
            out.append(_txt(x + cw / 2, y + 17, fmt.format(v), "middle", fg(v), 600, 11.5))
    return _fig("".join(out), title, caption, w, h)


def matrix3x3(items, title, caption="", xlab="投入", ylab="影响", xs=("低", "中", "高"), ys=("高", "中", "低")):
    """items: [(编号, x 档 0–2, y 档 0–2)]，y 档 0 = 影响高。九宫格每格列出编号；左上（影响高、投入低）用强调底色。
    比气泡图更适合档位数据：档位相同的项不会互相遮挡。"""
    cell = {}
    for i, x, y in items: cell.setdefault((x, y), []).append(i)
    cw, chh, lw, th = 190, 86, 54, 26; w = lw + cw * 3; h = th + chh * 3 + 24
    out = [_txt(lw + cw * j + cw / 2, 16, f"{xlab}{xs[j]}", "middle", MU, 600, 11) for j in range(3)]
    for r in range(3):
        y0 = th + chh * r
        out.append(_txt(lw - 8, y0 + chh / 2 + 4, f"{ylab}{ys[r]}", "end", MU, 600, 11))
        for c in range(3):
            x0 = lw + cw * c; hot = (r, c) == (0, 0)
            out.append(f'<rect x="{x0 + 2}" y="{y0 + 2}" width="{cw - 4}" height="{chh - 4}" rx="4" style="fill:{"var(--ac2)" if hot else "var(--sf2)"};stroke:{"var(--ac3)" if hot else GRID}"/>')
            ids = cell.get((c, r), [])
            for k, iid in enumerate(ids[:12]):
                cx, cy = x0 + 10 + (k % 3) * 60, y0 + 22 + (k // 3) * 20
                out.append(_txt(cx, cy, iid, fill="var(--ac)" if hot else TX, weight=600 if hot else 400, size=11.5))
            if len(ids) > 12: out.append(_txt(x0 + cw - 10, y0 + chh - 10, f"另 {len(ids) - 12} 项", "end", MU, size=10))
    return _fig("".join(out), title, caption, w, h)

