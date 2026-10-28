# -*- coding: utf-8 -*-
"""核心工具：表格、标题、目录、封面、评分计算。所有数字尽量由数据派生。"""
import re, html as _html
O=[]; TOC=[]; CUR=None; H2N=0
def w(s): O.append(s)
LEDGER={}
def N(value, key, fmt=',', unit=''):
    """数字账本：正文里的数字都经它输出。同一个 key 两次写入不同值直接报错（同一个数全文只能有一个来源）。
    输出 <span data-k="key">，number_gate.py 据此判定哪些数字已登记。fmt 为 format() 规格，如 ',' '.1f' '.0%'。"""
    if key in LEDGER and LEDGER[key]!=value: raise ValueError(f'数字账本冲突：{key} 先是 {LEDGER[key]!r}，又写成 {value!r}')
    LEDGER[key]=value
    return f'<span data-k="{key}">{format(value, fmt)}{unit}</span>'
NUMRE=re.compile(r'^[\s\d,.%+\-−▲▼/≈<>≥≤×:sKMBpxkmh天页次分秒张个条条\s]+$')
SHORT={'编号','由谁做','工作量','目标周','章节','优先级','国家','等级','周','#','市场','状态','判定','人日','来源','意图','级别','通过率','变化'}
def T(head, rows, num=None, cls='', me_col=None, colw=None):
    """head: 表头；rows: 行；num: 右对齐列集合（可自动判定）；me_col: 我们所在列索引；行首 ★ = 我们行；首格'合计' = 合计行"""
    head=list(head)
    for i,h in enumerate(head):
        if isinstance(h,str) and h.startswith('★'):
            head[i]=h[1:]
            if me_col is None: me_col=i
    n=len(head); num=set(num or [])
    clean=[]
    for r in rows:
        r=list(r); me=isinstance(r[0],str) and r[0].startswith('★')
        if me: r[0]=r[0][1:]
        total=isinstance(r[0],str) and r[0] in ('合计','总计')
        clean.append((r,me,total))
    # 自动数字列
    for i in range(1,n):
        vals=[str(r[i]) for r,_,_ in clean if i<len(r)]
        if vals and sum(1 for v in vals if NUMRE.match(re.sub(r'<[^>]+>','',v)) and re.search(r'\d',v))>=0.8*len(vals): num.add(i)
    hcls=lambda i,h: ' '.join(x for x in ['num' if i in num else '','nw' if h in SHORT else '','me' if i==me_col else ''] if x)
    th=''.join(f'<th class="{hcls(i,h)}">{h}</th>' for i,h in enumerate(head))
    body=''
    for r,me,total in clean:
        tr='<tr class="me">' if me else '<tr class="total">' if total else '<tr>'
        tds=''.join(f'<td class="{" ".join(x for x in ["num" if i in num else "","nw" if head[i] in SHORT else "","me" if i==me_col else ""] if x)}">{c}</td>' for i,c in enumerate(r))
        body+=tr+tds+'</tr>'
    long=' long' if len(clean)>=8 else ''
    cg=''.join(f'<col style="width:{x}">' if x else '<col>' for x in colw) if colw else ''
    w(f'<div class="tw"><table class="{cls}{long}">{("<colgroup>"+cg+"</colgroup>") if cg else ""}<thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>')
def tag(k,t): return f'<span class="tag {k}">{t}</span>'
def code(t): return f'<span class="code">{t}</span>'
def up(t): return f'<span class="up">{t}</span>'
def dn(t): return f'<span class="dn">{t}</span>'
def G(x,solid=False): return f'<span class="grade g{x}{" solid" if solid else ""}">{x}</span>'
def grade(s): return 'A' if s>=85 else 'B' if s>=70 else 'C' if s>=55 else 'D' if s>=40 else 'E'
def kpis(items):
    out=''
    for it in items:
        l,v,d=it[0],it[1],it[2]; k=it[3] if len(it)>3 else ''
        out+=f'<div class="kpi {k}"><div class="v">{v}</div><div class="l">{l}</div>'+(f'<div class="d">{d}</div>' if d else '')+'</div>'
    w('<div class="kpis">'+out+'</div>')
def band(v): return 'ok' if v>=70 else 'wa' if v>=55 else 'dg'
def sc(v,suffix=''): return f'<span class="sc {band(v)}">{v}{suffix}</span>'
def h2(t,sub=''):
    global H2N
    H2N+=1; hid=f'{CUR}-{H2N}'; TOC.append((hid,re.sub(r'<[^>]+>','',t)))  # 目录只放纯文本（标题里可能有 N() 的 span）
    w(f'<div class="eyebrow">第 {H2N:02d} 节 · 共 <!--TOT--> 节 · {DOCNAME}</div><h2 id="{hid}">{t}{f" <span class=hsub>{sub}</span>" if sub else ""}</h2>')
def h3(t): w(f'<h3>{t}</h3>')
def p(t,cls=''): w(f'<p class="{cls}">{t}</p>')
def box(t,title='',k=''): w(f'<div class="box {k}">{f"<h4>{title}</h4>" if title else ""}{t}</div>')
def note(t): w(f'<div class="note">{t}</div>')
def track(rows):
    w('<div>'+''.join(f'<div class="track"><span>{a}</span><i style="--w:{v}%;--c:{c}"></i><b>{v}</b></div>' for a,v,c in rows)+'</div>')
def qa_cell(s):
    if not s: return '<span class="mu">—</span>'
    m={'C':('引','q1'),'M':('名','q2'),'R':('荐','q3')}
    return ''.join(f'<span class="q {m[ch][1]}">{m[ch][0]}</span>' for ch in s if ch in m)
def eng(n,t): return f'<span class="eng"><i>{t}</i>{n}</span>'
E={'g':eng('ChatGPT','G'),'p':eng('Perplexity','P'),'ge':eng('Gemini','Ge'),'c':eng('Claude','C'),'ao':eng('Google AI 概览','AO'),'am':eng('Google AI Mode','AM'),'co':eng('Copilot','Co')}
def foot(a,b): w(f'<div class="foot"><span>{a}</span><span>{b}</span></div>')
# 诊断报告不含签字确认栏，原模板的 sig() 已删除
START=0; DOCNAME=''
def begin(doc_id, narrow=False, name=''):
    global CUR,H2N,TOC,START,DOCNAME
    CUR=doc_id; H2N=0; TOC=[]; START=len(O); DOCNAME=name
    w(f'<section class="doc{" narrow" if narrow else ""}{" on" if doc_id=="full" else ""}" id="doc-{doc_id}">')
def end():
    global O
    toc='<nav class="toc"><b>目录</b><ol>'+''.join(f'<li><a href="#{i}">{t}</a></li>' for i,t in TOC)+'</ol></nav>' if len(TOC)>=5 else ''
    seg='\n'.join(O[START:]).replace('<!--TOCHERE-->',toc,1).replace('<!--TOT-->',f'{H2N:02d}')
    del O[START:]
    O.append(seg)
    import json
    w('<script>SIDENAV["%s"]=%s;</script>'%(CUR,json.dumps([[i,t] for i,t in TOC],ensure_ascii=False)))
    w('</div></section>')
def ring(v,label):
    r=56; c=2*3.14159*r; d=c*v/100
    return f'<div><div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="{r}" fill="none" style="stroke:var(--ink-line)" stroke-width="10"/><circle cx="66" cy="66" r="{r}" fill="none" style="stroke:var(--acd)" stroke-width="10" stroke-linecap="round" stroke-dasharray="{d:.1f} {c:.1f}"/></svg><div class="c"><div><b>{v}</b><small>/ 100</small></div></div></div><div class="cap">{label}</div></div>'
def cover(kind_zh, kind_en, title, meta_parts, rid, right_lines, scores=None, ringv=None, sub=''):
    meta=' '.join(f'<span class="nb">{m}</span>' for m in meta_parts)
    right='<br>'.join(right_lines)
    strip=''
    if scores:
        strip='<div class="scorestrip">'+''.join(f'<div><div class="v {band(v)}">{v}<small>{s}</small></div><div class="l">{l}</div></div>' for l,v,s in scores)+'</div>'
    rg=ring(*ringv) if ringv else ''
    rightblock=f'<div class="right"><b>{rid}</b>{right}'+(f'<div class="ringwrap">{rg}<div>{strip}</div></div>' if rg else strip)+'</div>'
    w(f'<div class="cover"><div><div class="kind">{kind_zh}<span class="en">{kind_en}</span></div><h1>{title}</h1>'+(f'<div class="sub">{sub}</div>' if sub else '')+f'<div class="meta">{meta}</div></div>{rightblock}</div><div class="docbody"><!--TOCHERE-->')
def mark(v, ok=70, wa=55):
    """形状 + 颜色双编码的三档标记（Lighthouse 做法）：● 良好 / ■ 一般 / ▲ 较差；色弱与黑白打印也能分清。"""
    k='ok' if v>=ok else 'wa' if v>=wa else 'dg'
    return f'<span class="mk mk-{k}" title="{ {"ok":"良好","wa":"一般","dg":"较差"}[k] }"></span>'
def scale_legend(ok=70, wa=55):
    return f'<div class="legend"><span><span class="mk mk-dg"></span>较差 {N(0,"scale.min")}–{N(wa-1,"scale.dg_max")}</span><span><span class="mk mk-wa"></span>一般 {N(wa,"scale.wa")}–{N(ok-1,"scale.wa_max")}</span><span><span class="mk mk-ok"></span>良好 {N(ok,"scale.ok")}–{N(100,"scale.max")}</span></div>'

