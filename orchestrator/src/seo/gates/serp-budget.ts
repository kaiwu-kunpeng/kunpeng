import * as cheerio from "cheerio";
import type { Finding } from "../page-audit.js";

export interface SerpPage {
  url: string;
  html: string;
}

export interface SerpBudgetOptions {
  titleMax?: number;
  descriptionMin?: number;
  descriptionMax?: number;
  ogMinWidth?: number;
  ogRatioMin?: number;
  ogRatioMax?: number;
}

export interface SerpPageReport {
  url: string;
  title: string | null;
  titleLength: number;
  titleClipped: string;
  description: string | null;
  descriptionLength: number;
  ogImage: string | null;
  ogWidth: number | null;
  ogHeight: number | null;
  canonical: string | null;
  noindex: boolean;
  canonicalized: boolean;
}

export interface SerpVariant {
  url: string;
  canonical: string | null;
  noindex: boolean;
}

export interface DuplicateGroup {
  key: string;
  urls: string[];
}

export interface SerpBudgetResult {
  ok: boolean;
  findings: Finding[];
  pages: SerpPageReport[];
  duplicateTitles: DuplicateGroup[];
  duplicateDescriptions: DuplicateGroup[];
  variants: SerpVariant[];
}

export function normalizeSerpUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

export function rawTitle(html: string): string | null {
  // Measure the artifact's source text: HTML entities deliberately stay encoded.
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1].trim().replace(/\s+/g, " ") || null;
}

export function clipTitle(title: string, max: number): string {
  return [...title].slice(0, max).join("");
}

function imageDimension(content: string | undefined): number | null {
  const value = Number.parseInt(content ?? "", 10);
  return Number.isFinite(value) ? value : null;
}

export function runSerpBudgetGate(
  pages: SerpPage[],
  opts: SerpBudgetOptions = {},
): SerpBudgetResult {
  const {
    titleMax = 60,
    descriptionMin = 60,
    descriptionMax = 160,
    ogMinWidth = 1000,
    ogRatioMin = 1.2,
    ogRatioMax = 2.6,
  } = opts;
  const reports: SerpPageReport[] = [];
  const findings: Finding[] = [];
  const variants: SerpVariant[] = [];

  for (const { url, html } of pages) {
    const $ = cheerio.load(html);
    const canonicalHref = $("link[rel='canonical']").first().attr("href")?.trim();
    const canonical = canonicalHref ? normalizeSerpUrl(canonicalHref, url) : null;
    const noindex = $("meta[name='robots'], meta[name='googlebot']").toArray()
      .some((el) => /\bnoindex\b/i.test($(el).attr("content") ?? ""));
    const canonicalized = noindex || (canonical !== null && canonical !== normalizeSerpUrl(url, url));
    const title = rawTitle(html);
    const titleLength = [...(title ?? "")].length;
    const titleClipped = title === null ? "" : clipTitle(title, titleMax);
    const description = $("meta[name='description']").first().attr("content")?.trim() || null;
    const descriptionLength = [...(description ?? "")].length;
    const ogImage = $("meta[property='og:image']").first().attr("content") ?? null;
    const ogWidth = imageDimension($("meta[property='og:image:width']").first().attr("content"));
    const ogHeight = imageDimension($("meta[property='og:image:height']").first().attr("content"));
    reports.push({
      url, title, titleLength, titleClipped, description, descriptionLength,
      ogImage, ogWidth, ogHeight, canonical, noindex, canonicalized,
    });

    if (canonicalized) {
      variants.push({ url, canonical, noindex });
      findings.push({
        rule: "serp-canonical-variant",
        severity: "info",
        message: `${url}: ${noindex ? "noindex" : `canonical points to ${canonical}`}; excluded from SERP budget and duplicate checks.`,
        evidence: canonical ?? "noindex",
      });
      continue;
    }

    if (title === null) {
      findings.push({ rule: "serp-title-missing", severity: "error", message: `${url}: title is missing.` });
    } else if (titleLength > titleMax) {
      findings.push({
        rule: "serp-title-over-budget",
        severity: "error",
        message: `${url}: title has ${titleLength} characters; maximum is ${titleMax}.`,
        evidence: title,
      });
    }

    if (description === null) {
      findings.push({ rule: "serp-description-missing", severity: "warn", message: `${url}: description is missing.` });
    } else {
      if (descriptionLength < descriptionMin) {
        findings.push({
          rule: "serp-description-short",
          severity: "warn",
          message: `${url}: description has ${descriptionLength} characters; minimum is ${descriptionMin}.`,
        });
      }
      if (descriptionLength > descriptionMax) {
        findings.push({
          rule: "serp-description-over-budget",
          severity: "warn",
          message: `${url}: description has ${descriptionLength} characters; maximum is ${descriptionMax}.`,
        });
      }
    }

    if (!ogImage) {
      findings.push({ rule: "serp-og-image-missing", severity: "warn", message: `${url}: og:image is missing.` });
    } else if (ogWidth === null || ogHeight === null) {
      findings.push({
        rule: "serp-og-image-unknown-size",
        severity: "info",
        message: `${url}: og:image width or height is unknown.`,
      });
    } else {
      const ratio = ogWidth / ogHeight;
      if (ogWidth < ogMinWidth || !(ratio >= ogRatioMin && ratio <= ogRatioMax)) {
        findings.push({
          rule: "serp-og-image-size",
          severity: "warn",
          message: `${url}: og:image needs width >= ${ogMinWidth} and ratio ${ogRatioMin}–${ogRatioMax}.`,
          evidence: `${ogWidth}x${ogHeight}`,
        });
      }
    }
  }

  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  for (const report of reports) {
    if (report.canonicalized) continue;
    if (report.title !== null) {
      const key = report.titleClipped.toLowerCase().trim();
      const urls = titles.get(key) ?? [];
      urls.push(report.url);
      titles.set(key, urls);
    }
    if (report.description !== null) {
      const key = report.description.toLowerCase().trim();
      const urls = descriptions.get(key) ?? [];
      urls.push(report.url);
      descriptions.set(key, urls);
    }
  }
  const duplicateTitles = [...titles].filter(([, urls]) => urls.length >= 2)
    .map(([key, urls]) => ({ key, urls }));
  const duplicateDescriptions = [...descriptions].filter(([, urls]) => urls.length >= 2)
    .map(([key, urls]) => ({ key, urls }));
  for (const { key, urls } of duplicateTitles) {
    findings.push({
      rule: "serp-title-duplicate",
      severity: "error",
      message: `Duplicate clipped title "${key}" on ${urls.join(", ")}.`,
      evidence: urls.join(", "),
    });
  }
  for (const { key, urls } of duplicateDescriptions) {
    findings.push({
      rule: "serp-description-duplicate",
      severity: "warn",
      message: `Duplicate description "${key}" on ${urls.join(", ")}.`,
      evidence: urls.join(", "),
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    pages: reports,
    duplicateTitles,
    duplicateDescriptions,
    variants,
  };
}
