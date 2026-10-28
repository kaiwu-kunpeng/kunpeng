import * as cheerio from "cheerio";
import { visibleText } from "./first-html.js";
import type { Finding } from "../page-audit.js";

export type SweepFacet = "visible" | "title-description" | "json-ld" | "faq" | "social-meta" | "discovery";

export const PAGE_FACETS: readonly SweepFacet[] = [
  "visible", "title-description", "json-ld", "faq", "social-meta",
];

export interface SweepHit {
  url: string;
  facet: SweepFacet;
  term: string;
  snippet: string;
}

export function findTerm(haystack: string, term: string): string | null {
  const collapsed = haystack.replace(/\s+/g, " ").trim();
  const collapsedTerm = term.replace(/\s+/g, " ").trim();
  if (collapsedTerm === "") return null;
  const index = collapsed.toLowerCase().indexOf(collapsedTerm.toLowerCase());
  return index === -1
    ? null
    : collapsed.slice(Math.max(0, index - 40), index + collapsedTerm.length + 40);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectAnswers(value: unknown, answers: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAnswers(item, answers);
    return;
  }
  if (!isObject(value)) return;

  const type = value["@type"];
  if (type === "Question" || (Array.isArray(type) && type.includes("Question"))) {
    const accepted = Array.isArray(value.acceptedAnswer)
      ? value.acceptedAnswer
      : [value.acceptedAnswer];
    for (const answer of accepted) {
      if (isObject(answer) && typeof answer.text === "string") answers.push(answer.text);
    }
  }
  for (const child of Object.values(value)) collectAnswers(child, answers);
}

export function sweepHtml(html: string, url: string, terms: string[]): SweepHit[] {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]').toArray()
    .map((element) => $(element).text());
  const answers: string[] = [];
  for (const script of scripts) {
    let value: unknown;
    try {
      value = JSON.parse(script);
    } catch {
      // Invalid JSON-LD still participates in the raw json-ld facet.
      continue;
    }
    collectAnswers(value, answers);
  }
  for (const element of $('[itemprop="acceptedAnswer"]').toArray()) {
    answers.push($(element).text());
  }

  const social = [
    ...$('meta[property^="og:"]').toArray(),
    ...$('meta[name^="twitter:"]').toArray(),
  ].map((element) => $(element).attr("content") ?? "");
  const texts = new Map<SweepFacet, string>([
    ["visible", visibleText(html)],
    ["title-description", $("title").text() + " " + ($('meta[name="description"]').attr("content") ?? "")],
    ["json-ld", scripts.join("\n")],
    ["faq", answers.join("\n")],
    ["social-meta", social.join("\n")],
  ]);
  const hits: SweepHit[] = [];
  const uniqueTerms = [...new Set(terms)];
  for (const facet of PAGE_FACETS) {
    for (const term of uniqueTerms) {
      const snippet = findTerm(texts.get(facet)!, term);
      if (snippet !== null) hits.push({ url, facet, term, snippet });
    }
  }
  return hits;
}

export function sweepText(text: string, url: string, terms: string[]): SweepHit[] {
  const hits: SweepHit[] = [];
  for (const term of terms) {
    const snippet = findTerm(text, term);
    if (snippet !== null) hits.push({ url, facet: "discovery", term, snippet });
  }
  return hits;
}

export interface RetractionSweepInput {
  pages: Array<{ url: string; html: string }>;
  discovery?: Array<{ url: string; text: string }>;
  terms: string[];
}

export interface RetractionSweepResult {
  ok: boolean;
  findings: Finding[];
  hits: SweepHit[];
  checked: { pages: number; discovery: number; terms: number };
}

export function runRetractionSweep(input: RetractionSweepInput): RetractionSweepResult {
  const normalized = [...new Set(input.terms.map((term) => term.trim()).filter((term) => term !== ""))];
  const checked = {
    pages: input.pages.length,
    discovery: input.discovery?.length ?? 0,
    terms: normalized.length,
  };
  if (normalized.length === 0) {
    return {
      ok: false,
      findings: [{
        rule: "retraction-terms-empty",
        severity: "error",
        message: "Retraction sweep requires at least one non-empty term.",
      }],
      hits: [],
      checked,
    };
  }

  const hits = [
    ...input.pages.flatMap(({ url, html }) => sweepHtml(html, url, normalized)),
    ...(input.discovery ?? []).flatMap(({ url, text }) => sweepText(text, url, normalized)),
  ];
  const findings: Finding[] = hits.map((hit) => ({
    rule: "retraction-hit",
    severity: "error",
    message: `Retracted term "${hit.term}" remains in ${hit.facet} at ${hit.url}.`,
    evidence: hit.snippet,
  }));
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    hits,
    checked,
  };
}

export interface RetractionFetchOptions {
  urls: string[];
  terms: string[];
  discoveryUrls?: string[];
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export async function fetchRetractionSweep(
  opts: RetractionFetchOptions,
): Promise<RetractionSweepResult & { failed: Array<{ url: string; status: number }> }> {
  const { fetchImpl = fetch, userAgent = "kunpeng-seo/0.1" } = opts;
  const pages: RetractionSweepInput["pages"] = [];
  const discovery: Array<{ url: string; text: string }> = [];
  const failed: Array<{ url: string; status: number }> = [];

  for (const [urls, isDiscovery] of [[opts.urls, false], [opts.discoveryUrls ?? [], true]] as const) {
    for (const url of urls) {
      try {
        const res = await fetchImpl(url, {
          headers: { "user-agent": userAgent, accept: "text/html,text/plain" },
          redirect: "follow",
        });
        if (res.status !== 200) {
          failed.push({ url, status: res.status });
          continue;
        }
        const text = await res.text();
        if (isDiscovery) discovery.push({ url, text });
        else pages.push({ url, html: text });
      } catch {
        failed.push({ url, status: 0 });
      }
    }
  }

  const result = runRetractionSweep({ pages, discovery, terms: opts.terms });
  for (const { url, status } of failed) {
    result.findings.push({
      rule: "retraction-unverified",
      severity: "error",
      message: `Retraction could not be verified at ${url}: status ${status}.`,
      evidence: url,
    });
  }
  return {
    ...result,
    ok: !result.findings.some((finding) => finding.severity === "error"),
    failed,
  };
}
