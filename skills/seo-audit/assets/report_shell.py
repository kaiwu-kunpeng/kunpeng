# -*- coding: utf-8 -*-
"""报告外壳：页头、左侧目录、滚动进度、节号占位符替换、残留占位符断言。

用法（在自己的 gen.py 里）：
    import report_shell as S
    S.start(title="xxx.com SEO 与 AI 可见性诊断", site="xxx.com", brand=cfg["issuer"]["name"], theme="graphite-cobalt", edition="audit")
    my_report.render()                       # 用 g_core 写正文：begin("full", name="诊断报告") … cover/h2/T/p … end()（doc id 用 "full" 才会默认显示）
    S.finish(out_path, refs={"METHSEC": "数据范围", "CMPSEC": "竞品"})

正文里写 {METHSEC} 这类占位符，finish 按节标题前缀替换成两位节号；任何未替换的 {XXXSEC} 都会让生成失败。
正文里的 f-string 要写成 {{METHSEC}}，否则 Python 会当成变量。
正文数字用 C.N(值, "键") 输出（数字账本），finish 时账本写到 <报告>.ledger.json。
"""
import os, re
import g_core as C

HERE = os.path.dirname(os.path.abspath(__file__))
_PRINT = False
EXTRA_CSS = """
.tag.have{color:var(--ok);background:var(--okb)}.tag.part{color:var(--wa);background:var(--wab)}.tag.miss{color:var(--dg);background:var(--dgb)}.tag.opt{color:var(--mu);background:var(--sf2)}
.src{color:var(--mu);font-size:12px}span.ok{color:var(--ok);font-weight:600}span.bad{color:var(--dg);font-weight:600}
code{font-family:var(--mono);font-size:12px;background:var(--sf2);padding:0 3px;border-radius:3px}
details{margin:12px 0}details summary{cursor:pointer;color:var(--ac);font-weight:600}
table.mat td{white-space:nowrap}
"""


def start(title, site, brand="开悟科技", subtitle="SEO 与 AI 可见性诊断", theme="graphite-cobalt", accent=None, edition="audit", print_pages=None):
    """theme 见 themes.THEMES；accent 是客户品牌色（只作强调色）；edition 决定附加样式（brief 用 assets/brief.css）。
    print_pages：打印页眉页码、每节分页、打印前展开折叠区。默认完整诊断版（audit）不加，保持与已交付版一致；其他版本默认加。"""
    global _PRINT
    _PRINT = (edition != "audit") if print_pages is None else print_pages
    import themes
    css = themes.root_css(theme, accent) + open(os.path.join(HERE, "base.css")).read() + EXTRA_CSS
    if _PRINT: css += open(os.path.join(HERE, "print.css")).read().replace("{BRAND}", _cssq(brand)).replace("{TITLE}", _cssq(title)).replace("{SITE}", _cssq(site))
    if edition != "audit": css += open(os.path.join(HERE, f"{edition}.css")).read()
    C.w(f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>{css}</style></head><body class="ed-{edition}">
<div class="topbar" id="topbar"><div class="topin"><div class="brand">{brand}<i></i><small>{subtitle}</small></div>
<div class="sp"></div><span class="chip site">{site}</span><span class="chip btn" onclick="window.print()">打印 / 存为 PDF</span></div></div>
<div class="wrap"><nav class="sidenav" id="sidenav"></nav><div class="sheet"><script>const SIDENAV={{}};</script>''')


def _cssq(t):
    return str(t).replace("\\", "").replace('"', "'")


def finish(out_path, refs=None):
    toc = [t for _, t in C.TOC]
    body = "\n".join(C.O)
    for ph, prefix in (refs or {}).items():
        n = next((i + 1 for i, t in enumerate(toc) if t.startswith(prefix)), None)
        if n is None: raise SystemExit(f"占位符 {{{ph}}} 找不到以「{prefix}」开头的节")
        body = body.replace("{" + ph + "}", f"{n:02d}")
    body += '''</div></div>
<div class="totop" id="totop" title="回到顶部">↑</div>
<script>
const nav=document.getElementById('sidenav'),bar=document.getElementById('topbar'),totop=document.getElementById('totop');
(function(){const doc=Object.keys(SIDENAV)[0];const items=SIDENAV[doc]||[];const b=document.createElement('b');b.textContent='目录';nav.appendChild(b);
items.forEach(([id,txt])=>{const a=document.createElement('a');a.href='#'+id;a.textContent=txt;a.onclick=e=>{e.preventDefault();document.getElementById(id).scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'','#'+id)};nav.appendChild(a)});
const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){nav.querySelectorAll('a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')=='#'+e.target.id))}})},{rootMargin:'-70px 0px -70% 0px'});
items.forEach(([id])=>{const el=document.getElementById(id);if(el)obs.observe(el)})})();
function onScroll(){const d=document.documentElement,p=d.scrollHeight>d.clientHeight?d.scrollTop/(d.scrollHeight-d.clientHeight)*100:0;bar.style.setProperty('--p',p.toFixed(1)+'%');totop.classList.toggle('on',d.scrollTop>600)}
window.addEventListener('scroll',onScroll,{passive:true});onScroll();
totop.onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
/*BEFOREPRINT*/
</script></body></html>'''
    body = body.replace("/*BEFOREPRINT*/", "window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));" if _PRINT else "")
    left = sorted(set(re.findall(r"\{[A-Z]+SEC\}", body)))
    if left: raise SystemExit(f"残留占位符：{left}")
    open(out_path, "w").write(body)
    if C.LEDGER:  # 数字账本落盘到报告旁边，供审查 agent 与 number_gate 使用
        import json
        json.dump(C.LEDGER, open(os.path.splitext(out_path)[0] + ".ledger.json", "w"), ensure_ascii=False, indent=1, default=str)
    return len(body)
