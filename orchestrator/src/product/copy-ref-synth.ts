import { parseIaFromLinks, extractPositioning, extractThemeColor, extractBrandStyles } from "./copy-ref.js";
import { createProduct } from "./registry-service.js";
import { writeSpec } from "./loop-store.js";
import { extractFirstJsonObject } from "../util/extract-json.js";
import type { AgentRunner } from "../agent/runner.js";
import { wrapUntrusted } from "../security/prompt-shield.js";

export interface RefScrape {
  rawHtml: string;
  markdown: string;
  metadata: Record<string, unknown>;
  links: string[];
  host: string;
}

export interface SynthResult {
  slug: string;
  title: string;
  ia: string[];
  themeColor?: string;
}

interface SynthBrandStyles {
  colors: string[];
  fonts: string[];
}

function buildBrandStylesSection(brandStyles?: SynthBrandStyles): string[] {
  if (!brandStyles || (brandStyles.colors.length === 0 && brandStyles.fonts.length === 0)) {
    return [];
  }

  return [
    "## 参考站品牌样式",
    `colors: ${brandStyles.colors.length > 0 ? brandStyles.colors.join(", ") : "[]"}`,
    `fonts: ${brandStyles.fonts.length > 0 ? brandStyles.fonts.join(", ") : "[]"}`,
  ];
}

function mergeThemeColor(themeColor: string | undefined, colors: string[]): string[] {
  if (!themeColor) {
    return colors;
  }

  const merged = [themeColor];
  const seen = new Set<string>([themeColor.toLowerCase()]);
  for (const color of colors) {
    const key = color.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(color);
  }
  return merged;
}

export function buildSynthPrompt(ref: RefScrape, ia: string[], title: string, brandStyles?: SynthBrandStyles): string {
  return [
    "请把以下已抓取的参考站点内容逆向成产品文档、仅依据材料勿编造。",
    "输出必须是单个 JSON 对象，格式为:",
    "{\"problem\":string,\"users\":string[],\"stories\":string[],\"acceptance\":string[],\"specMarkdown\":string}",
    `标题: ${title}`,
    `页面: ${ia.join(", ")}`,
    ...buildBrandStylesSection(brandStyles),
    "正文:",
    ref.markdown.slice(0, 6000),
  ].join("\n");
}

function parseSpecMarkdown(text: string): string {
  try {
    const parsed: unknown = JSON.parse(extractFirstJsonObject(text));
    if (typeof parsed === "object" && parsed !== null && "specMarkdown" in parsed) {
      const specMarkdown = parsed.specMarkdown;
      return typeof specMarkdown === "string" ? specMarkdown : "";
    }
  } catch {
    return "";
  }
  return "";
}

export async function synthesizeFromRef(
  repoRoot: string,
  ref: RefScrape,
  runner: AgentRunner,
  now: number,
): Promise<SynthResult> {
  const ia = parseIaFromLinks(ref.links, ref.host);
  const pos = extractPositioning(ref.metadata);
  const themeColor = extractThemeColor(ref.metadata);
  const brandStyles = extractBrandStyles(typeof ref.rawHtml === "string" ? ref.rawHtml : "");
  const promptBrandStyles = {
    colors: mergeThemeColor(themeColor, brandStyles.colors),
    fonts: brandStyles.fonts,
  };
  const trimmedTitle = pos.title?.trim();
  const title = trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : ref.host;

  const res = await runner.run({
    stage: "spec",
    system: "",
    input: wrapUntrusted("竞品抓取站点内容", buildSynthPrompt(ref, ia, title, promptBrandStyles)),
    tools: [],
  });
  const specMarkdown = parseSpecMarkdown(res.text);

  const product = await createProduct(repoRoot, title, now, "copy-ref");
  await writeSpec(repoRoot, product.slug, specMarkdown);

  return { slug: product.slug, title, ia, themeColor };
}
