import * as cheerio from "cheerio";
import { countWords } from "./text-metrics.js";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  evidence?: string;
}

export interface HeadingNode {
  level: number;
  text: string;
}

export interface PageAudit {
  url: string;
  lang: string | null;
  charset: string | null;
  title: { text: string; length: number } | null;
  description: { text: string; length: number } | null;
  canonical: string | null;
  robots: { noindex: boolean; nofollow: boolean };
  headings: HeadingNode[];
  h1Count: number;
  images: { total: number; missingAlt: number; emptyAlt: number; altEqualsFilename: number };
  hreflang: Array<{ lang: string; href: string }>;
  links: { internal: number; external: number; nofollow: number };
  wordCount: number;
  replacementChars: number;
  findings: Finding[];
}

export interface AuditPageOptions {
  url: string;
  httpCharset?: string;
}

export const PAGE_AUDIT_RULES: readonly string[] = [
  "title-missing", "title-length", "description-missing", "description-length",
  "h1-missing", "h1-multiple", "heading-skip", "heading-empty",
  "img-alt-missing", "img-alt-filename", "html-lang-missing",
  "canonical-missing", "canonical-relative", "noindex",
  "hreflang-no-x-default", "hreflang-self-missing",
  "mojibake", "charset-mismatch", "charset-missing",
];

function textFact(value: string): { text: string; length: number } | null {
  const text = value.trim();
  return text ? { text, length: [...text].length } : null;
}

function normalizeAlt(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, " ");
}

export function auditPageHtml(html: string, opts: AuditPageOptions): PageAudit {
  const $ = cheerio.load(html);
  const lang = $("html").attr("lang")?.trim() || null;
  const contentType = $("meta[http-equiv]").filter((_index, element) =>
    $(element).attr("http-equiv")?.toLowerCase() === "content-type",
  ).first().attr("content");
  const rawCharset = $("meta[charset]").first().attr("charset")
    ?? contentType?.match(/(?:^|;)\s*charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  const charset = rawCharset === undefined ? null : rawCharset.trim().toLowerCase();
  const title = textFact($("title").first().text());
  const description = textFact($("meta[name='description']").first().attr("content") ?? "");
  const canonical = $("link[rel='canonical']").first().attr("href")?.trim() ?? null;
  const robotTokens = ($("meta[name='robots']").first().attr("content") ?? "")
    .split(",").map((token) => token.trim().toLowerCase());
  const robots = {
    noindex: robotTokens.includes("noindex"),
    nofollow: robotTokens.includes("nofollow"),
  };
  const headings: HeadingNode[] = $("h1,h2,h3,h4,h5,h6").toArray().map((element) => ({
    level: Number(element.tagName.slice(1)),
    text: $(element).text().trim(),
  }));
  const h1Count = headings.filter((heading) => heading.level === 1).length;

  const images = { total: 0, missingAlt: 0, emptyAlt: 0, altEqualsFilename: 0 };
  const missingAltSources: string[] = [];
  $("img").each((_index, element) => {
    images.total++;
    const alt = $(element).attr("alt");
    const src = $(element).attr("src") ?? "";
    if (alt === undefined) {
      images.missingAlt++;
      if (missingAltSources.length < 5) missingAltSources.push(src);
    } else if (alt.trim() === "") {
      images.emptyAlt++;
    } else {
      const filename = src.split("?")[0].split("/").pop() ?? "";
      const stem = filename.replace(/\.[^.]*$/, "");
      if (normalizeAlt(stem) === normalizeAlt(alt.trim())) images.altEqualsFilename++;
    }
  });

  const hreflang = $("link[rel='alternate'][hreflang]").toArray().map((element) => ({
    lang: $(element).attr("hreflang") ?? "",
    href: $(element).attr("href") ?? "",
  }));
  const links = { internal: 0, external: 0, nofollow: 0 };
  $("a[href]").each((_index, element) => {
    const href = ($(element).attr("href") ?? "").trim();
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
    if (href.startsWith("/")) {
      links.internal++;
    } else {
      try {
        if (new URL(href, opts.url).origin === new URL(opts.url).origin) links.internal++;
        else links.external++;
      } catch {
        // 规格要求跳过无法解析的链接，包括其 nofollow 计数。
        return;
      }
    }
    if (($(element).attr("rel") ?? "").split(/\s+/).includes("nofollow")) links.nofollow++;
  });

  $("script,style,noscript,template").remove();
  const wordCount = countWords($("body").text());
  const replacementChars = (html.match(/\uFFFD/g) ?? []).length;
  const findings: Finding[] = [];
  const add = (rule: string, severity: Severity, message: string, evidence?: string): void => {
    const finding: Finding = { rule, severity, message };
    if (evidence !== undefined) finding.evidence = evidence;
    findings.push(finding);
  };

  if (title === null) {
    add("title-missing", "error", "页面缺少非空标题。");
  } else if (title.length < 10 || title.length > 60) {
    add("title-length", "warn", `标题长度为 ${title.length} 个字符，建议为 10–60 个字符。`);
  }
  if (description === null) {
    add("description-missing", "warn", "页面缺少非空描述。");
  } else if (description.length < 50 || description.length > 160) {
    add("description-length", "warn", `描述长度为 ${description.length} 个字符，建议为 50–160 个字符。`);
  }
  if (h1Count === 0) add("h1-missing", "error", "页面缺少 H1 标题。");
  if (h1Count > 1) add("h1-multiple", "warn", `页面包含 ${h1Count} 个 H1 标题。`);
  headings.forEach((heading, index) => {
    const previous = headings[index - 1];
    if (previous && heading.level > previous.level + 1) {
      add("heading-skip", "warn", "标题层级存在跳级。", `H${previous.level}→H${heading.level}`);
    }
    if (heading.text === "") {
      add("heading-empty", "warn", "标题内容为空。", `h${heading.level}`);
    }
  });
  if (images.missingAlt > 0) {
    add("img-alt-missing", "warn", `${images.missingAlt} 张图片缺少 alt 属性。`, missingAltSources.join(", "));
  }
  if (images.altEqualsFilename > 0) {
    add("img-alt-filename", "warn", `${images.altEqualsFilename} 张图片的 alt 与文件名相同。`);
  }
  if (lang === null) add("html-lang-missing", "error", "页面缺少非空的 html lang 属性。");
  if (canonical === null) {
    add("canonical-missing", "warn", "页面缺少 canonical 链接。");
  } else if (!/^https?:\/\//.test(canonical)) {
    add("canonical-relative", "warn", "canonical 链接应使用完整的 HTTP 或 HTTPS 地址。");
  }
  if (robots.noindex) add("noindex", "info", "页面声明了 noindex，搜索引擎不会将其编入索引。");
  if (hreflang.length > 0) {
    if (!hreflang.some((link) => link.lang.toLowerCase() === "x-default")) {
      add("hreflang-no-x-default", "warn", "hreflang 链接缺少 x-default。");
    }
    if (!hreflang.some((link) => link.href.replace(/\/+$/, "") === opts.url.replace(/\/+$/, ""))) {
      add("hreflang-self-missing", "warn", "hreflang 链接缺少当前页面的自指地址。");
    }
  }
  if (replacementChars > 0) {
    add("mojibake", "error", `HTML 包含 ${replacementChars} 个替换字符，可能存在乱码。`);
  }
  const httpCharset = opts.httpCharset?.toLowerCase();
  if (charset !== null && httpCharset && charset !== httpCharset) {
    add("charset-mismatch", "error", "HTML 与 HTTP 声明的字符编码不一致。", `meta=${charset} http=${httpCharset}`);
  }
  if (charset === null && !httpCharset) {
    add("charset-missing", "warn", "HTML 与 HTTP 均未声明字符编码。");
  }

  // 稳定排序保留同一规则内的文档顺序。
  findings.sort((a, b) => PAGE_AUDIT_RULES.indexOf(a.rule) - PAGE_AUDIT_RULES.indexOf(b.rule));
  return {
    url: opts.url, lang, charset, title, description, canonical, robots,
    headings, h1Count, images, hreflang, links, wordCount, replacementChars, findings,
  };
}
