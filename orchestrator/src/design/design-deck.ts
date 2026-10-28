// 幻灯片(PPT)deck 生成:把设计系统提示词包成 deck 提示词。零依赖纯函数。
export type DeckLocale = "zh" | "en" | "both";

// 幻灯片专属规则。必含子串(测试锚点):16:9、signature、数据、bullet。
export const DECK_RULES: string = `幻灯片规则(优先级高于通用):
- 画幅 16:9;每页只讲一个信息点,标题即结论。
- 页型:封面 / 目录 / 章节卡 / 要点页 / 数据页 / 收束页;按内容选,不硬凑。
- 一套 deck 只押一个 signature 视觉母题(贯穿全 deck,不每页换花样)。
- 数据用克制图表,禁"大数字+渐变线"套路;颜色严格走设计系统 token。
- 文案即设计材料:动词开头、忌 bullet-soup(一页 <= 5 点、每点 <= 12 字)、具体优于口号。
- 沿用上方设计系统的配色/字体/反AI味黑名单,幻灯片同样不许撞三大默认审美。`;

// locale 指令:both=每页中英双语对照;zh=只中;en=只英。
export function localeDirective(locale: DeckLocale): string {
  if (locale === "both") {
    return "每页中英双语对照(中文主、英文副标)";
  }

  if (locale === "en") {
    return "全英文";
  }

  return "全中文";
}

// 组合:设计系统提示词 + 幻灯片规则 + locale + 页数。slides 缺省 10。
export function composeDeckPrompt(
  systemPrompt: string,
  opts?: { locale?: DeckLocale; slides?: number },
): string {
  const locale = opts?.locale ?? "zh";
  const slides = opts?.slides ?? 10;

  return `${systemPrompt}\n\n# 幻灯片(PPT)生成\n${DECK_RULES}\n语言:${localeDirective(
    locale,
  )}\n建议页数:${slides}`;
}
