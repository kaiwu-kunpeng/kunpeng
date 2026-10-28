import * as cheerio from "cheerio";
import type { Finding } from "../page-audit.js";
import { normalizeSerpUrl } from "./serp-budget.js";

export interface CanonicalPage {
  url: string;
  html: string;
}

export interface CanonicalTargetOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** 标题相似度低于此值时报 canonical-target-dissimilar（0~1，默认 0.2）。 */
  similarityMin?: number;
}

export interface CanonicalTargetInfo {
  status: number;
  canonical: string | null;
  noindex: boolean;
  title: string | null;
  crossOrigin: boolean;
  chain: boolean;
  similarity: number | null;
}

export interface CanonicalTargetReport {
  url: string;
  canonical: string | null;
  self: boolean;
  noindex: boolean;
  title: string | null;
  target: CanonicalTargetInfo | null;
}

export interface CanonicalTargetResult {
  ok: boolean;
  checked: number;
  fetched: number;
  pages: CanonicalTargetReport[];
  findings: Finding[];
}

const DEFAULT_USER_AGENT = "kunpeng-seo-canonical/1.0";

function pageTitle($: cheerio.CheerioAPI): string | null {
  const text = $("title").first().text().replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function pageNoindex($: cheerio.CheerioAPI): boolean {
  return $("meta[name='robots'], meta[name='googlebot']").toArray()
    .some((el) => /\bnoindex\b/i.test($(el).attr("content") ?? ""));
}

function tokens(title: string): Set<string> {
  const lower = title.toLowerCase();
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  // 无空格的长标题（CJK 常见）按字符二元组切，否则整句是一个词、相似度失真。
  if (words.length <= 1 && [...lower].length > 8) {
    const chars = [...lower.replace(/\s+/g, "")];
    return new Set(chars.slice(0, -1).map((c, i) => c + chars[i + 1]));
  }
  return new Set(words);
}

/** 两个标题的 Jaccard 相似度（0~1）。 */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / (ta.size + tb.size - both);
}

export async function runCanonicalTargetGate(
  pages: CanonicalPage[],
  opts: CanonicalTargetOptions = {},
): Promise<CanonicalTargetResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const similarityMin = opts.similarityMin ?? 0.2;
  const findings: Finding[] = [];
  const reports: CanonicalTargetReport[] = [];
  const known = new Map<string, string>();
  for (const page of pages) {
    const self = normalizeSerpUrl(page.url, page.url);
    if (self !== null) known.set(self, page.html);
  }
  const targetCache = new Map<string, Promise<{ status: number; html: string }>>();
  let fetched = 0;
  const loadTarget = (target: string): Promise<{ status: number; html: string }> => {
    const knownHtml = known.get(target);
    if (knownHtml !== undefined) return Promise.resolve({ status: 200, html: knownHtml });
    let pending = targetCache.get(target);
    if (pending === undefined) {
      fetched++;
      pending = fetchImpl(target, { headers: { "user-agent": userAgent }, redirect: "follow" })
        .then(async (res) => ({ status: res.status, html: res.status === 200 ? await res.text() : "" }))
        .catch(() => ({ status: 0, html: "" }));
      targetCache.set(target, pending);
    }
    return pending;
  };

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const href = $("link[rel='canonical']").first().attr("href")?.trim();
    const canonical = href ? normalizeSerpUrl(href, page.url) : null;
    const selfUrl = normalizeSerpUrl(page.url, page.url);
    const title = pageTitle($);
    const noindex = pageNoindex($);
    const isSelf = canonical !== null && canonical === selfUrl;
    const report: CanonicalTargetReport = { url: page.url, canonical, self: isSelf, noindex, title, target: null };
    reports.push(report);
    if (canonical === null || isSelf) continue;

    const { status, html } = await loadTarget(canonical);
    const crossOrigin = (() => {
      try { return new URL(canonical).origin !== new URL(page.url).origin; } catch { return false; }
    })();
    const info: CanonicalTargetInfo = {
      status, canonical: null, noindex: false, title: null, crossOrigin, chain: false, similarity: null,
    };
    report.target = info;
    if (crossOrigin) {
      findings.push({
        rule: "canonical-cross-origin", severity: "info",
        message: `${page.url}: canonical points to another origin ${canonical}.`, evidence: canonical,
      });
    }
    if (status !== 200) {
      findings.push({
        rule: "canonical-target-unreachable", severity: "error",
        message: `${page.url}: canonical target ${canonical} returned status ${status}.`, evidence: canonical,
      });
      continue;
    }
    const t$ = cheerio.load(html);
    const targetHref = t$("link[rel='canonical']").first().attr("href")?.trim();
    info.canonical = targetHref ? normalizeSerpUrl(targetHref, canonical) : null;
    info.noindex = pageNoindex(t$);
    info.title = pageTitle(t$);
    info.chain = info.canonical !== null && info.canonical !== canonical;
    if (info.noindex) {
      findings.push({
        rule: "canonical-target-noindex", severity: "error",
        message: `${page.url}: canonical target ${canonical} is noindex, so neither URL can be indexed.`, evidence: canonical,
      });
    }
    if (info.chain) {
      findings.push({
        rule: "canonical-chain", severity: "error",
        message: `${page.url}: canonical target ${canonical} itself canonicalizes to ${info.canonical}; point directly at the final URL.`,
        evidence: info.canonical ?? canonical,
      });
    }
    if (title !== null && info.title !== null) {
      info.similarity = Number(titleSimilarity(title, info.title).toFixed(3));
      if (!noindex && info.similarity < similarityMin) {
        findings.push({
          rule: "canonical-target-dissimilar", severity: "warn",
          message: `${page.url}: title "${title}" shares little with canonical target title "${info.title}" (similarity ${info.similarity}); a wrong canonical drops the page from search.`,
          evidence: canonical,
        });
      }
    }
  }
  return {
    ok: !findings.some((f) => f.severity === "error"),
    checked: reports.filter((r) => r.canonical !== null && !r.self).length,
    fetched,
    pages: reports,
    findings,
  };
}