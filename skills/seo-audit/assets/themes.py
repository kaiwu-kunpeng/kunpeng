# -*- coding: utf-8 -*-
"""报告主题：语义令牌 → 取值。组件与 base.css 只引用 var(--*)，换主题只换这里的取值。

结构借鉴 IBM Carbon 的语义令牌（Apache-2.0）与 zairuilab/consulting-deck 的主题与中文字体栈（Apache-2.0）。
状态色（ok / wa / dg）是保留色，所有主题相同，不拿来当系列色。
字体只用系统自带，不嵌字体、不外链，国内外都能直接打开。
客户品牌色只作强调色注入：root_css(theme, accent="#E4002B")，浅色衍生用 color-mix 计算。
"""

CLASSIC_SANS = '"Inter","Segoe UI",-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Noto Sans SC","Helvetica Neue","Microsoft YaHei",sans-serif'  # 已交付版（v3 以前）的字体顺序
SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif'
SERIF = '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif'
MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace'

STATUS = {"ok": "#1B8A5A", "okb": "#E8F5EE", "ok-ln": "#C6E6D4", "ok-on-ink": "#3FBF86",
          "wa": "#C27200", "wab": "#FFF5E3", "wa-ln": "#F3DFB4", "wa-on-ink": "#E9A23B",
          "dg": "#C43B2A", "dgb": "#FCEBE8", "dg-ln": "#F3C9C2", "dg-on-ink": "#F0604D"}

BASE = {  # 石墨 + 钴蓝：完整诊断版默认，与 v3 及以前的 style4.css 取值一致
    "ink": "#14181E", "ink2": "#1C2129", "ink3": "#252B34", "ink-line": "#2C333E", "ink-line2": "#3A4250",
    "on-ink": "#FFFFFF", "on-ink-2": "#E5E9EF", "on-ink-sub": "#D5DAE2", "on-ink-mu": "#9AA3B2", "on-ink-mu2": "#B6BEC9",
    "on-ink-mu3": "#8792A3", "on-ink-sep": "#4A5261",
    "ac": "#2456D6", "ac2": "#EBF0FC", "ac3": "#C9D6F6", "acd": "#7DA0F0",
    "ln": "#E3E6EB", "ln2": "#CBD0D8", "bg": "#F3F4F6", "sf": "#FFFFFF", "sf2": "#F8F9FB",
    "tx": "#14181E", "tx2": "#3B4451", "mu": "#6B7482", "in": "#2456D6", "inb": "#EBF0FC", "lo": "#6B7482",
    "row-alt": "#FAFBFC", "row-hover": "#F4F6FA", "shadow-sm": "rgba(20,24,30,.05)", "shadow": "rgba(16,24,40,.2)",
    "series-1": "var(--ac)", "series-2": "var(--acd)", "series-3": "var(--ink3)", "series-4": "var(--mu)", "series-5": "var(--ln2)", "series-6": "var(--tx2)",  # 图表系列色，不用状态色
    "th-bg": "var(--ink)", "th-tx": "var(--on-ink-2)", "h2-rule": "var(--ac)", "radius": "6px", "radius-sm": "4px",
    "font-sans": SANS, "font-serif": SERIF, "font-head": SANS, "mono": MONO,
    **STATUS,
}

THEMES = {
    "graphite-cobalt": {**BASE, "font-sans": CLASSIC_SANS, "font-head": CLASSIC_SANS},  # 完整诊断版默认：与已交付版视觉一致
    # 墨蓝衬线：高管摘要版默认，标题宋体系，显得正式
    "ink-serif": {**BASE, "ink": "#0B2A4A", "ink2": "#123459", "ink3": "#1A3F69", "ink-line": "#24486F", "ink-line2": "#335A84",
                  "on-ink-mu": "#A7B6C9", "on-ink-mu2": "#C2CDDB", "on-ink-mu3": "#8EA0B6", "on-ink-sep": "#3E5878",
                  "bg": "#F4F5F7", "tx": "#0B2A4A", "tx2": "#2E3F55", "font-head": SERIF, "h2-rule": "#0B2A4A", "radius": "2px", "radius-sm": "0"},
    # 深青绿：方案执行版默认，与诊断版明显区分
    "teal-playbook": {**BASE, "ink": "#0F2E2B", "ink2": "#153B37", "ink3": "#1C4843", "ink-line": "#26544E", "ink-line2": "#336660",
                      "ac": "#0F766E", "ac2": "#E3F2F0", "ac3": "#B9DDD8", "acd": "#5FB8AE", "in": "#0F766E", "inb": "#E3F2F0",
                      "bg": "#F5F4F0", "sf2": "#FAF9F6", "on-ink-mu": "#A3BDB9", "on-ink-mu2": "#C1D4D1", "on-ink-mu3": "#88A5A1",
                      "on-ink-sep": "#3B5F5A"},
    # 瑞士灰：技术附录版默认，灰阶为主，状态色只用在标签上
    "swiss-mono": {**BASE, "ink": "#101820", "ink2": "#18222C", "ink3": "#212C37", "ac": "#245BDB", "ac2": "#ECF1FD", "ac3": "#CAD7F7",
                   "acd": "#7FA2F2", "in": "#245BDB", "inb": "#ECF1FD", "bg": "#F4F4F4", "sf2": "#F9F9F9",
                   "th-bg": "#E6E8EB", "th-tx": "#101820", "h2-rule": "#101820", "radius": "0", "radius-sm": "0"},
}


def root_css(theme="graphite-cobalt", accent=None):
    if theme not in THEMES: raise SystemExit(f"未知主题 {theme}，可选：{', '.join(THEMES)}")
    t = dict(THEMES[theme])
    if accent:
        t.update({"ac": accent, "in": accent, "ac2": f"color-mix(in srgb,{accent} 9%,#fff)", "inb": f"color-mix(in srgb,{accent} 9%,#fff)",
                  "ac3": f"color-mix(in srgb,{accent} 28%,#fff)", "acd": f"color-mix(in srgb,{accent} 55%,#fff)"})
    return ":root{" + ";".join(f"--{k}:{v}" for k, v in t.items()) + "}"
