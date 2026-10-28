import { hexToOklch } from "./color-engine.js";

export interface DesignColorTokens {
  light?: Record<string, { $value: string }>;
  dark?: Record<string, { $value: string }>;
}

export interface RenderReview {
  pass: boolean;
  issues: string[];
}

function normalizeHex(hex: string): string | undefined {
  const trimmed = hex.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

function uniqueNormalizedHexes(hexes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const hex of hexes) {
    const normalized = normalizeHex(hex);
    if (normalized) {
      out.add(normalized);
    }
  }
  return [...out];
}

function looksLikeHtml(html: string): boolean {
  const h = html.toLowerCase();
  return (
    h.includes("<!doctype") ||
    h.includes("<html") ||
    h.includes("<body") ||
    h.includes("<section") ||
    (h.includes("<div") && h.includes("<style"))
  );
}

export function extractHexColors(html: string): string[] {
  return uniqueNormalizedHexes(html.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) ?? []);
}

export function paletteHexes(tokens: DesignColorTokens): string[] {
  const values: string[] = [];
  for (const mode of [tokens.light, tokens.dark]) {
    if (!mode) {
      continue;
    }
    for (const token of Object.values(mode)) {
      values.push(token.$value);
    }
  }
  return uniqueNormalizedHexes(values);
}

function isNeutral(hex: string): boolean {
  return hexToOklch(hex).c < 0.04;
}

function oklabDist(h1: string, h2: string): number {
  const c1 = hexToOklch(h1);
  const c2 = hexToOklch(h2);
  const h1Rad = (c1.h * Math.PI) / 180;
  const h2Rad = (c2.h * Math.PI) / 180;

  return Math.hypot(
    c1.l - c2.l,
    c1.c * Math.cos(h1Rad) - c2.c * Math.cos(h2Rad),
    c1.c * Math.sin(h1Rad) - c2.c * Math.sin(h2Rad),
  );
}

export function nearestPaletteHex(hex: string, palette: string[]): string {
  if (palette.length === 0) {
    return hex;
  }

  const normalizedHex = normalizeHex(hex);
  if (!normalizedHex) {
    return hex;
  }

  let nearest = hex;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const paletteHex of palette) {
    const normalizedPaletteHex = normalizeHex(paletteHex);
    if (!normalizedPaletteHex) {
      continue;
    }

    const dist = oklabDist(normalizedHex, normalizedPaletteHex);
    if (dist < nearestDist) {
      nearest = normalizedPaletteHex;
      nearestDist = dist;
    }
  }

  return nearest;
}

export function offPaletteColors(html: string, palette: string[], tol = 0.18): string[] {
  const normalizedPalette = uniqueNormalizedHexes(palette);
  return extractHexColors(html).filter((hex) => {
    if (isNeutral(hex)) {
      return false;
    }
    return normalizedPalette.every((paletteHex) => oklabDist(hex, paletteHex) > tol);
  });
}

export function structuralRepeats(html: string): number {
  return html.match(/<h1\b/gi)?.length ?? 0;
}

export function repeatedBlocks(html: string, minLen = 200, minRepeats = 3): number {
  const counts = new Map<string, number>();
  const countBlock = (block: string): void => {
    const comparable = block.replace(/\s+/g, " ").trim();
    if (comparable.length >= minLen) {
      counts.set(comparable, (counts.get(comparable) ?? 0) + 1);
    }
  };

  for (const tag of ["main", "section", "article", "div", "header", "footer", "nav", "aside", "ul", "ol"]) {
    const tagBlock = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = tagBlock.exec(html)) !== null) {
      countBlock(match[0]);
    }
  }

  const parts = html
    .replace(/>\s*/g, ">\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let block = "";
  for (const part of parts) {
    block += part;
    if (block.length >= minLen) {
      countBlock(block);
      block = "";
    }
  }

  return [...counts.values()].filter((count) => count >= minRepeats).length;
}

export function renderReview(html: string, tokens: DesignColorTokens, bloatBytes = 120000): RenderReview {
  const palette = paletteHexes(tokens);
  const off = offPaletteColors(html, palette);
  const h1 = structuralRepeats(html);
  const blocks = repeatedBlocks(html);
  const issues: string[] = [];

  if (!looksLikeHtml(html)) {
    issues.push("产物不是 HTML 文档(疑似模型在叙述/解释而非输出代码),必须只输出从 <!doctype html> 开始的纯 HTML");
  }
  if (off.length > 0) {
    const sample = off[0];
    issues.push(`用了 ${off.length} 个离调色板的颜色(如 ${sample}→建议 ${nearestPaletteHex(sample, palette)}),收敛到设计系统色`);
  }
  if (h1 > 1 || blocks > 0) {
    issues.push(`页面结构重复(${h1} 个<h1>/${blocks} 处大块重复),删除重复版块`);
  }
  if (html.length > bloatBytes) {
    issues.push(`产物臃肿(${html.length} 字节),精简冗余结构与重复`);
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}
