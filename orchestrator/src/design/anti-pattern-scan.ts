export interface AntiPatternHit {
  id: string;
  rule: string;
}

export function scanAntiPatterns(code: { css?: string; html?: string }): AntiPatternHit[] {
  const css = (code.css ?? "").toLowerCase();
  const html = code.html ?? "";
  const hits: AntiPatternHit[] = [];

  if (
    /linear-gradient/.test(css) &&
    /(#?(8b5cf6|a855f7|7c3aed|6d28d9|9333ea|6366f1)|purple|紫)/.test(css)
  ) {
    hits.push({ id: "no-purple-gradient", rule: "禁紫蓝渐变(AI味指纹)" });
  }

  // 真 emoji(1F300-1FAFF)+ 杂项符号(2600-26FF,含 ⚡🔥☀)。
  // 故意排除 2700-27BF dingbat(✓✗✂✏ 等合法状态字形,非装饰 emoji)——dogfood 自扫鲲鹏发现的误报修正。
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u.test(html)) {
    hits.push({ id: "no-emoji-icon", rule: "禁 emoji 当图标,用 SVG" });
  }

  if (/font-family\s*:\s*(["']?)(inter|roboto|arial|open sans|system-ui)\1/.test(css)) {
    hits.push({ id: "no-default-font", rule: "禁默认退回 Inter/Roboto/Arial,需指定字体配对" });
  }

  if (/outline\s*:\s*(none|0)\b/.test(css) && !/:focus-visible/.test(css)) {
    hits.push({ id: "a11y-focus", rule: "禁删 focus ring(无障碍底线)" });
  }

  const durations = [...css.matchAll(/transition[^;{}]*?(\d+)ms/g)].map((match) => Number(match[1]));
  if (durations.some((duration) => duration === 0 || duration > 500)) {
    hits.push({ id: "motion-150-300", rule: "动效应 150-300ms,禁 0ms/禁 >500ms" });
  }

  if ((css.match(/blur\(/g) ?? []).length >= 3) {
    hits.push({ id: "no-blur-everywhere", rule: "禁无意义全局模糊(滥用 blur)" });
  }

  return hits;
}
