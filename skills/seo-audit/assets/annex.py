# -*- coding: utf-8 -*-
"""技术附录版（edition = annex）：给客户技术团队与外包方，高密度、可执行、可导出。默认主题 swiss-mono。

数据契约（字典 D，生成器从完整诊断版的同一数据层取值；数字经 g_core.N 输出，判断句经 claims.claim）：
  title, site, client, date, rid, issuer, mode（diagnosis / plan）
  meta      [(标签, 值)]                                    # 元信息条，替代大封面：站点、抓取页数、日期、编号、出具方
  issues    [{"sev": "error" | "warning" | "notice", "check": 检查项, "pages": 影响范围（已经 N() 的字符串，带单位：页 / 条 / 张）,
              "evidence": 证据一句, "opp": 建议编号（诊断模式留空）}]                         # 问题总表，按严重度分组
  template  [{"id": 编号, "what": 改什么, "where": 改在哪（模板 / 配置）, "how": 怎么改}]    # 模板级改法（plan 模式）
  rewrites  {"columns": [...], "rows": [[...]], "note": 说明}                                # 重点页改写稿，服务端写入全部行、可勾选、可导出
  matrix    {"cols": [检查项], "rows": [(页面, [True | False | None | 文本])], "note": 说明} # URL × 检查项，横向页
  lists     [{"id", "title", "columns": [...], "rows": [[...]], "note"}]                    # URL 清单：嵌 JSON、分页、导出 CSV
  snippets  [{"title", "code", "note"}]                                                      # 配置与代码片段，等宽
  scope     数据范围一句话
可选 titles：各节标题（键 issues / template / rewrites / matrix / lists / snippets / scope），默认是带计数的陈述句。
诊断模式不出 template 与 rewrites（属于方案），传了即报错。
表体由服务端先写入（全量打印的表写全部行，长清单写第一页），行数据另放 <script type="application/json">，页面内小脚本接管分页、导出 CSV（UTF-8 带 BOM，Excel 可直接打开），
不联网；打印时改写稿全部行展开，URL 清单只印当前页并注明总行数，完整清单请导出 CSV。
"""
import html as _h
import json
import re
import g_core as C

SEV = [("error", "错误", "dg"), ("warning", "警告", "wa"), ("notice", "提示", "in")]
PAGE = 25


def _e(t): return _h.escape(str(t))


def _check(D):
    need = ["title", "site", "client", "date", "rid", "issuer", "meta", "issues", "matrix", "lists", "snippets", "scope"]
    miss = [k for k in need if k not in D]
    if miss: raise SystemExit(f"技术附录版缺字段：{miss}")
    if D.get("mode") != "plan" and (D.get("template") or D.get("rewrites")):
        raise SystemExit("诊断模式不出修改单与改写稿（template / rewrites），切 plan 模式或删掉")
    bad = [i for i in D["issues"] if i["sev"] not in {s for s, _, _ in SEV}]
    if bad: raise SystemExit(f"问题严重度只能是 error / warning / notice：{bad[:1]}")


def _cell(v):
    if v is True: return '<span class="mk mk-ok"></span><span class="sr">通过</span>'
    if v is False: return '<span class="mk mk-dg"></span><span class="sr">未通过</span>'
    if v is None: return '<span class="mu">—</span>'
    return _e(v)


def _rows_html(rows, check):
    """服务端先写入表体（要全部打印的表写全部行，长清单写第一页），不启用脚本也能看，扫描工具也读得到；脚本只接管分页与导出。"""
    return "".join("<tr>" + ('<td class="ck"><span class="ckbox"></span></td>' if check else "") + "".join(f"<td>{_e(c)}</td>" for c in r) + "</tr>" for r in rows)


def _datatable(tid, columns, rows, note="", check=False, print_all=False):
    """前端渲染的数据表：行数据放 JSON，分页 + 导出 CSV。check=True 时每行前加可勾选方框。"""
    payload = json.dumps({"columns": columns, "rows": rows, "check": check, "printAll": print_all}, ensure_ascii=False).replace("</", "<\\/")
    C.w(f'<div class="dt" id="{tid}"><div class="dt-bar"><span class="dt-count"></span>'
        f'<span class="sp"></span><button type="button" class="dt-csv">导出 CSV</button></div>'
        f'<div class="tw"><table data-quote class="dt-table{" dt-check" if check else ""}"><thead><tr>{"<th class=nw>完成</th>" if check else ""}'
        + "".join(f"<th>{_e(c)}</th>" for c in columns) + '</tr></thead><tbody>' + _rows_html(rows if print_all or len(rows) <= PAGE else rows[:PAGE], check)
        + '</tbody></table></div>'
        f'<div class="dt-pager"></div><noscript><p class="mu">未启用脚本时只显示第一页，完整清单可在浏览器中翻页或导出。</p></noscript>'
        f'<script type="application/json" class="dt-data">{payload}</script></div>')
    if note: C.w(f'<p class="mu">{note}</p>')


JS = r"""<script>
(function(){
var PAGE=%d;
function csv(cols,rows){var q=function(v){v=String(v==null?'':v).replace(/<[^>]+>/g,'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
 return '﻿'+[cols.map(q).join(',')].concat(rows.map(function(r){return r.map(q).join(',')})).join('\n')}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
document.querySelectorAll('.dt').forEach(function(box){
 var d=JSON.parse(box.querySelector('.dt-data').textContent),tb=box.querySelector('tbody'),pg=box.querySelector('.dt-pager'),cur=0,all=false;
 var pages=Math.max(1,Math.ceil(d.rows.length/PAGE));
 function draw(){var rows=all?d.rows:d.rows.slice(cur*PAGE,cur*PAGE+PAGE);
  tb.innerHTML=rows.map(function(r){return '<tr>'+(d.check?'<td class="ck"><span class="ckbox"></span></td>':'')+r.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('');
  box.querySelector('.dt-count').textContent='共 '+d.rows.length+' 行'+(pages>1&&!all?' · 第 '+(cur+1)+' / '+pages+' 页':'');
  pg.innerHTML=pages>1&&!all?'<button type="button" data-p="-1">上一页</button><button type="button" data-p="1">下一页</button>':'';
  box.classList.toggle('dt-partial',!all&&pages>1)}
 pg.addEventListener('click',function(e){var p=e.target.getAttribute('data-p');if(!p)return;cur=Math.min(pages-1,Math.max(0,cur+(+p)));draw()});
 box.querySelector('.dt-csv').addEventListener('click',function(){var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv(d.columns,d.rows)],{type:'text/csv;charset=utf-8'}));a.download=box.id+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)});
 window.addEventListener('beforeprint',function(){if(d.printAll){all=true;draw()}});
 window.addEventListener('afterprint',function(){if(all){all=false;draw()}});
 draw()});
})();
</script>""" % PAGE


def render(D, titles=None):
    _check(D)
    t = {"issues": "问题总表", "template": "模板级修改单", "rewrites": "重点页改写稿", "matrix": "重点页逐项检查",
         "lists": "问题页面清单", "snippets": "配置与代码示例", "scope": "数据范围", **(titles or {})}
    C.begin("full", name="技术附录")
    C.w('<div class="metastrip"><div class="ms-k">技术附录 · TECHNICAL ANNEX</div><h1>' + _e(D["title"]) + '</h1><dl>'
        + "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in D["meta"]) + '</dl></div><div class="docbody"><!--TOCHERE-->')

    C.h2(t["issues"])
    for sev, label, k in SEV:
        rows = [i for i in D["issues"] if i["sev"] == sev]
        if not rows: continue
        C.w(f'<h3 class="sevh"><span class="tag {"u" if k == "dg" else "w" if k == "wa" else "i"}">{label}</span> {C.N(len(rows), f"issues.{sev}")} 项</h3>')
        head = ["检查项", "影响范围", "证据"] + (["建议编号"] if D.get("mode") == "plan" else [])
        C.T(head, [[i["check"], i["pages"], i["evidence"]] + ([C.code(i.get("opp") or "—")] if D.get("mode") == "plan" else []) for i in rows],
            cls=f"sev sev-{k}")

    if D.get("mode") == "plan" and D.get("template"):
        C.h2(t["template"])
        C.T(["完成", "编号", "改什么", "改在哪", "怎么改"],
            [['<span class="ckbox"></span>', C.code(x["id"]), x["what"], x["where"], x["how"]] for x in D["template"]], cls="chk")
    if D.get("mode") == "plan" and D.get("rewrites"):
        rw = D["rewrites"]
        C.h2(t["rewrites"])
        C.w('<div class="wide">'); _datatable("rewrites", rw["columns"], rw["rows"], rw.get("note", ""), check=True, print_all=True); C.w("</div>")

    mx = D["matrix"]
    C.h2(t["matrix"])
    C.w('<div class="legend"><span><span class="mk mk-ok"></span>通过</span><span><span class="mk mk-dg"></span>未通过</span><span><span class="mu">—</span> 不适用</span></div>')
    C.w('<div class="wide">')
    C.T(["页面"] + mx["cols"], [[r[0]] + [_cell(v) for v in r[1]] for r in mx["rows"]], cls="mx")
    C.w("</div>")
    if mx.get("note"): C.p(mx["note"], "mu")

    C.h2(t["lists"])
    for L in D["lists"]:
        C.h3(L["title"])
        _datatable(L["id"], L["columns"], L["rows"], L.get("note", ""))

    C.h2(t["snippets"])
    for s in D["snippets"]:
        C.h3(s["title"])
        C.w(f'<pre class="snip"><code>{_e(s["code"])}</code></pre>')
        if s.get("note"): C.p(s["note"], "mu")

    C.h2(t["scope"])
    C.p(D["scope"])
    C.foot(f"{D['issuer']} · 技术附录", D["rid"])
    C.w(JS)
    # 目录用纯文本：节标题里的 N() 标签不能进侧栏（共用的 g_core.h2 / report_shell 目录脚本待统一处理）
    C.end()
