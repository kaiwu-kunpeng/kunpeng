# -*- coding: utf-8 -*-
"""中文 AI 腔与商务语体规则：scan_report.py 用。

规则来源（均为 MIT，按许可保留出处）：
  LF  = larashero3-dotcom/lieflat-less-ai-tone（283 万字人机对照语料实测倍率）
  HW  = KKKKhazix/human-writing check_prose.py
  MBA = stephenlzc/humanize-mba-text-skill rules/*.toml
  PT  = devswha/patina lexicon/ai-zh.md
  SSZ = VincentOld/stop-slop-zh phrases.md
  HZ  = op7418/Humanizer-zh、Hyacehila/humanizer-zh-next
  TL  = textlint-ja 规则设计；BD = mizzlelover/biaodian（GB/T 15834）
  CL  = 本 skill references/client-language.md（客户要求）
级别：must = 命中即不可交付；look = 打印上下文人工看；dens = 按每千汉字密度判。
已被 LF 语料证伪、不要立规则的：句长段长均匀、虚词少、被动句、句内排比、正文「首先…其次」、比喻本身。
改规则前先在历史终稿上抽看 20 条命中，再看频率；结构类指标的分母用同类元素总数。
"""
import html, re

RULES = []  # (id, level, compiled, note, src)


def _r(i, lv, rx, note, src):
    RULES.append((i, lv, re.compile(rx, re.M), note, src))


# 自问自答（客户硬要求）
_r("Q1", "must", r"[？?]", "正文问号", "CL")
_r("Q3", "must", r"答案(是|很简单|恰恰相反)|恰恰相反", "自答提示", "HW")
# 翻案腔
_r("P1", "look", r"(?:并)?不是[^。！？\n]{1,40}?[，,]?\s*而是", "不是…而是（纠正第三方结论时可保留）", "LF 3.4x、HW")
_r("P2", "look", r"并非[^。！？\n]{1,40}?而是|不在于[^。！？\n]{1,40}?而在于|与其说[^。！？\n]{1,40}?(不如|倒不如)", "翻案变体", "LF、HW")
_r("P3", "look", r"(看似|表面(上)?)[^。！？\n]{0,40}?(其实|实则|实际上)", "假揭示", "HW")
_r("P4", "must", r"真正[^，。！？\n]{0,16}的(，)?是|[^，。！？\n]{1,12}不重要，(重要|关键)的是", "伪洞察", "HW")
_r("P5", "must", r"不仅(仅)?是[^。！？\n]{1,30}?[，,]\s*(更|还)是|问题来了|那么问题是", "递进翻案、自设悬念", "HW")
# 起手式与路标
_r("S1", "must", r"说白了|说穿了|先说结论|一句话(总结|概括|说)|简单(来)?说|说到底", "口语起手式", "LF 3.2x、HW")
_r("S2", "must", r"值得(注意|一提|关注)的是|需要指出的是|不难(看出|发现)|不可否认|毋庸置疑|显而易见|众所周知|不言而喻", "强调虚壳", "PT、SSZ、MBA")
_r("S3", "look", r"这意味着|这表明|这说明|换句话说|也就是说|换言之", "推论台阶", "LF")
_r("S4", "must", r"归根结底|本质上|底层逻辑|深层逻辑", "权威姿态", "HW、HZ")
# 元话语与聊天残留
_r("M1", "must", r"让我们|接下来(我们)?(将|来)|下面(我们)?(来)?(看|分析|拆解|介绍)|废话不多说", "导览式开场", "SSZ、HZ")
_r("M2", "look", r"本(文|报告|节|章)将(从|围绕|重点)", "过程宣告", "HZ")
_r("M3", "must", r"希望(这|本报告|以上)[^。]{0,8}(帮助|参考)|如有(任何)?(疑问|问题)[，,]?(请|欢迎)|当然(可以|没问题)", "客服腔", "MBA")
_r("M4", "must", r"作为(一个)?(AI|人工智能|语言模型)|截至(我的)?(训练|知识)|基于(现有|可用)信息|由于(资料|信息)(有限|不足)", "知识边界免责", "MBA、CL")
# 拔高与宣传
_r("E1", "must", r"至关重要|举足轻重|不可或缺|重中之重", "意义拔高", "PT、MBA")
_r("E2", "must", r"(具有|有着)(重要|深远|里程碑|划时代)(的)?(意义|价值)|意义(重大|深远)|影响深远", "意义拔高", "PT、MBA")
_r("E3", "look", r"发挥着?(重要|关键|至关重要的?)作用|扮演着?[^，。]{0,8}角色", "空作用句", "PT")
_r("E4", "must", r"(彰显|凸显|体现)(了|出)[^，。]{0,12}(重要性|价值|实力|决心|追求|魅力)", "句尾拔高", "HZ、MBA")
_r("E5", "must", r"奠定(了)?(坚实的?)?基础|开启(了)?新(的)?篇章|迈向新(的)?阶段|注入(新的)?活力|释放(巨大)?潜力|未来可期|前景(广阔|可期)|拭目以待", "公式化展望", "PT、MBA、HZ")
_r("E6", "must", r"赋能|抓手|闭环|打通|护城河|组合拳|全链路|降本增效|颗粒度|心智|飞轮|破圈|出圈|赛道|痛点|打法", "互联网黑话（引用客户原文放进「」）", "HW、SSZ、MBA")
_r("E7", "must", r"卓越|非凡|极致|无与伦比|堪称|令人(惊叹|瞩目|赞叹)|无可挑剔", "宣传语", "MBA")
_r("E8", "look", r"显著(提升|改善|增长|提高)", "程度词后应跟数据", "MBA")
# 背景开场
_r("F1", "must", r"在当今|(数字化|信息化|全球化|AI|人工智能)(时代|浪潮)|在[^，。]{0,10}(时代|浪潮)(背景)?下", "宏大背景开场", "SSZ、PT")
_r("F2", "look", r"随着[^，。]{2,20}的(不断|快速|飞速|持续)?(发展|普及|进步|演进)", "背景开场", "HZ")
# 模糊归因与语体
_r("G1", "must", r"(有|据|相关)研究(表明|显示|指出)|业内(人士|普遍)|专家(普遍)?(认为|指出)|普遍认为", "无来源归因", "MBA、HZ")
_r("H1", "must", r"(可能|或许|也许|大概)[^。！？\n]{0,10}(可能|或许|也许|大概)", "限定词堆叠", "HZ")
_r("H2", "must", r"一定程度上|在某种程度上|从某种意义上(说|讲)?|某种意义上", "模糊限定", "MBA、LF")
_r("H3", "must", r"挺|蛮|啥|咋|搞定|弄清|反正|说实话|老实说|坦白(说|讲)", "口语词", "CL、SSZ")
_r("H4", "look", r"非常|十分|极其|特别|格外", "程度副词，优先换数据", "SSZ")
_r("H6", "look", r"进行(了)?[^，。]{0,6}(分析|优化|调整|评估|检查|讨论|梳理)", "轻动词", "HW")
_r("H7", "look", r"我(们)?(认为|觉得|相信)|笔者", "主观口吻，改为「开悟认为」或「数据显示」", "公文思路")
# 标点
_r("I1", "dens", r"(?<=[一-鿿])——(?=[一-鿿])", "破折号（>0.5 次/千汉字判失败）", "LF 3.0x")
_r("I2", "look", r"(总结|小结|结论|核心(是|在于)?|关键(是|在于)?|重点(是)?|原因(如下|有|在于)?|问题(是|在于)?|本质(是|上)?)[：:]", "提示性冒号", "LF 3.8x")
_r("I3", "look", r"(以下|如下)[几\d一二三四五六七八九十]+(个|种|类|点|方面)[^。\n]{0,10}[：:]\s*$", "空转句引出列表", "LF 9.4x")
_r("I4", "must", r"[！!]", "感叹号", "TL")
_r("I5", "must", r"[一-鿿]\"|\"[一-鿿]", "中文语境用了英文直引号", "MBA、GB/T 15834")
_r("I6", "must", r"[。，、；：？！]{2,}", "连续标点", "BD")
_r("I7", "must", r"…{1,2}[^。！？\n]{0,10}?(等|等等)", "省略号与「等」连用", "BD")
_r("I8", "must", "[\U0001F300-\U0001FAFF☀-☄☆-➿]", "表情符号（★ 评分星标除外）", "MBA")
# 结构
_r("J1", "must", r"(这|此)(充分)?(说明|表明|体现|彰显)了?[^。]{0,20}(重要性|必要性|价值|意义)。", "段尾统一升华", "MBA")
_r("J2", "look", r"(?:^|[。！？])\s*(总而言之|综上所述|总的来说|总之)", "套话收尾", "PT、SSZ")
_r("J3", "must", r"(?:^|[。！？])\s*(此外|同时|另外|然而|因此)[^。！？\n]*[。！？]\s*\1", "相邻句同一连词开头", "TL")
_r("J4", "must", r"XXX|TODO|待补|【[^】]*待[^】]*】|\{[A-Za-z_]+\}|请在此处(填写|补充)", "占位符残留", "MBA")

COMMENT = re.compile(r"^(?:听起来|看起来|看上去|说到底|换句话说|意味着|值得注意|不难看出|问题在于|原因在于|结果是|更重要的是|关键在于|真正的)")
ANAPHOR = re.compile(r"^(?:这|那|其|此|上述|前述|以上|该|它|同样|类似|相比|但|不过|所以|因此|于是|而|另)")
BLOCK = re.compile(r"(?i)</(p|li|td|th|h\d|div|tr|summary|caption)>|<br\s*/?>")


QUOTE = re.compile(r"(?is)<table\b[^>]*\bdata-quote\b.*?</table>")


def text_lines(raw, skip_quote=False):
    """只在块级标签处断行（行内的 <b>、<a> 不切句），返回 (行, 标题)。
    skip_quote=True 时去掉带 data-quote 的表（客户网站原文、外文改写稿、URL 清单等原始数据），AI 腔规则只查我们写的话。"""
    raw = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", raw)
    if skip_quote: raw = QUOTE.sub(" ", raw)
    heads = [html.unescape(re.sub(r"<[^>]+>", "", h)).strip() for h in re.findall(r"(?is)<h[1-4][^>]*>(.*?)</h[1-4]>", raw)]
    txt = html.unescape(re.sub(r"<[^>]+>", "", BLOCK.sub("\n", raw)))
    return [l.strip() for l in txt.splitlines() if l.strip()], heads


def mask(t):
    """屏蔽误报来源：网址与路径、引号内原话、以 ASCII 为主的外文片段。"""
    t = re.sub(r"https?://\S+|(?<![一-鿿])/[\w./?=*&%-]+", " ", t)
    t = re.sub(r"[“「『][^”」』\n]{0,200}[”」』]", "〔引〕", t)
    return re.sub(r"[A-Za-z0-9 ,.'?!:;()/&*=_-]{12,}", " ", t)


def check(lines, heads, allow=()):
    """返回 [(id, level, note, 片段)] 与汉字千字数。allow 是放行词（客户品牌词、引用原文）。"""
    masked = [mask(l) for l in lines]
    for w in allow:
        masked = [l.replace(w, "〔放〕") for l in masked]
    body = "\n".join(masked)
    k = len(re.findall(r"[一-鿿]", body)) / 1000 or 1
    out = []
    for i, lv, rx, note, _ in RULES:
        n = 0
        for l in masked:
            for m in rx.finditer(l):
                n += 1
                if lv != "dens": out.append((i, lv, note, l[max(0, m.start() - 18):m.end() + 18]))
        if lv == "dens" and n / k > 0.5: out.append((i, "must", note, f"{n} 次，{n / k:.2f}/千汉字"))
    paras = [l for l in masked if len(l) >= 30]
    out += [("J5", "look", "段首零主语评论", p[:40]) for j, p in enumerate(paras) if j and COMMENT.match(p) and not ANAPHOR.match(p)]
    out += [("Q4", "must", "问句标题", h) for h in heads if h.endswith(("？", "?"))]
    out += [("J6", "look", "序数词当小标题", h) for h in heads if re.match(r"^(首先|其次|再次|最后|第一|第二|第三)", h)]
    if "你" in body.replace("你们", "") and "您" in body: out.append(("H8", "must", "你、您混用", ""))
    for s in re.split(r"[。！？；\n]", body):
        z = len(re.findall(r"[一-鿿]", s))
        if z > 80 or s.count("，") > 6 or (z >= 38 and s.count("的") >= 4): out.append(("J7", "look", "长句、逗号过多或层叠的「的」", s[:40]))
    return out, k
