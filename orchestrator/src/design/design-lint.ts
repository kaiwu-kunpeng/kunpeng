export type Severity = "P0" | "P1" | "P2";

export interface LintHit {
  rule: string;
  severity: Severity;
  message: string;
}

export interface DesignCode {
  css?: string;
  html?: string;
}

export interface LintReport {
  hits: LintHit[];
  counts: { P0: number; P1: number; P2: number };
}

function styleText(code: DesignCode): string {
  const css = code.css ?? "";
  const rawHtml = code.html ?? "";
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, " ");
  const styleBlocks = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).map((block) =>
    block.replace(/<\/?style[^>]*>/gi, " "),
  );
  const inlineStyles = (html.match(/style\s*=\s*("[^"]*"|'[^']*')/gi) ?? []).map((style) =>
    style.replace(/^style\s*=\s*['"]|['"]$/gi, " "),
  );
  return [css, ...styleBlocks, ...inlineStyles].join("\n");
}

function hasCreamSerif(text: string): boolean {
  const hasCream = /#(?:f4f1ea|f5f2ea|faf7f0)\b/i.test(text);
  const hasSerif = /\bgeorgia\b/i.test(text) || /(^|[^a-z-])serif\b/i.test(text);
  return hasCream && hasSerif;
}

function hasDarkAcid(text: string): boolean {
  const hasNearBlack = /#(?:0a0a0a|111111|111)\b/i.test(text);
  const hasAcidAccent = /#(?:39ff14|ccff00|ff4500)\b/i.test(text);
  return hasNearBlack && hasAcidAccent;
}

function hasBroadsheet(text: string): boolean {
  const hasZeroRadius = /border-radius\s*:\s*0(?:px)?\b/i.test(text);
  const hasHairline = /\bborder(?:-(?:top|right|bottom|left))?\s*:\s*1px\s+solid\b/i.test(text);
  const hasDenseColumns =
    /column-count\s*:\s*\d+/i.test(text) ||
    /grid-template-columns\s*:\s*repeat\s*\(/i.test(text);
  return hasZeroRadius && hasHairline && hasDenseColumns;
}

export function detectDefaultAesthetics(code: DesignCode): LintHit[] {
  const text = styleText(code);
  const hits: LintHit[] = [];

  if (hasCreamSerif(text)) {
    hits.push({
      rule: "default-cream-serif",
      severity: "P0",
      message: "命中暖奶油底色搭配衬线字体的一眼 AI 默认审美。",
    });
  }

  if (hasDarkAcid(text)) {
    hits.push({
      rule: "default-dark-acid",
      severity: "P0",
      message: "命中近黑底色搭配荧光绿或朱红强调色的一眼 AI 默认审美。",
    });
  }

  if (hasBroadsheet(text)) {
    hits.push({
      rule: "default-broadsheet",
      severity: "P0",
      message: "命中零圆角、1px hairline 细线与密排多栏组合的一眼 AI 默认审美。",
    });
  }

  return hits;
}

export function lintDesign(code: DesignCode): LintReport {
  const hits = detectDefaultAesthetics(code);
  const counts: LintReport["counts"] = { P0: 0, P1: 0, P2: 0 };

  for (const hit of hits) {
    counts[hit.severity] += 1;
  }

  return { hits, counts };
}
