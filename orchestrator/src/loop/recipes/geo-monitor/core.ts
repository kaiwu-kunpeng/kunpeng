import { extractFirstJsonObject } from "../../../util/extract-json.js";

export interface GeoConfig {
  brandNames: string[];
  brandDomains: string[];
  questions: string[];
}

export interface GeoAnswer {
  question: string;
  mentioned: boolean;
  citedDomains: string[];
  citedUrls: string[];
  summary?: string;
  error?: string;
  backend?: string;
  model?: string;
  at?: number;
}

interface ParsedGeoAnswer {
  summary?: unknown;
  citedDomains?: unknown;
  citedUrls?: unknown;
  mentionedBrand?: unknown;
}

type StoredGeoAnswer = Omit<GeoAnswer, "citedUrls"> & { citedUrls?: string[] };

export function geoPrompt(
  question: string,
  config: Pick<GeoConfig, "brandNames" | "brandDomains">,
): string {
  return [
    "Use live web search to answer the user question.",
    "Report the complete page-level URLs you cited or recommended, not citedDomains or site homepages, and whether the answer mentions the configured brand.",
    `Question: ${question}`,
    `Brand names to compare: ${config.brandNames.join(", ")}`,
    `Brand domains to compare: ${config.brandDomains.join(", ")}`,
    'Return only JSON with exactly this shape: {"summary":"...","citedUrls":["https://example.com/page"],"mentionedBrand":true}',
    "Do not include markdown, commentary, or text outside the JSON object.",
  ].join("\n");
}

export function parseGeoAnswer(
  question: string,
  text: string,
  config: Pick<GeoConfig, "brandNames" | "brandDomains">,
): GeoAnswer {
  let parsed: ParsedGeoAnswer;
  try {
    parsed = JSON.parse(extractFirstJsonObject(text)) as ParsedGeoAnswer;
  } catch {
    return { question, mentioned: false, citedDomains: [], citedUrls: [], error: "unparseable" };
  }

  const citedUrls = normalizeCitedUrls(parsed.citedUrls);
  const citedDomains = mergeDomains(
    normalizeDomains(parsed.citedDomains),
    citedUrls.map(domainFromUrl),
  );
  const brandDomains = config.brandDomains.map(comparableDomain).filter((domain) => domain.length > 0);
  const citedBrandDomain = citedDomains.some((domain) =>
    brandDomains.some((brandDomain) => domainMatches(comparableDomain(domain), brandDomain)),
  );
  const mentioned = parsed.mentionedBrand === true || citedBrandDomain;
  const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;

  return summary === undefined
    ? { question, mentioned, citedDomains, citedUrls }
    : { question, mentioned, citedDomains, citedUrls, summary };
}

export function summarizeGeoWave(answers: StoredGeoAnswer[]): {
  mentions: number;
  total: number;
  errors: number;
  instrumentBroken: boolean;
  gaps: string[];
} {
  const total = answers.length;
  const errors = answers.filter((answer) => answer.error !== undefined).length;
  return {
    mentions: answers.filter((answer) => answer.mentioned).length,
    total,
    errors,
    instrumentBroken: total > 0 && errors === total,
    gaps: answers
      .filter((answer) => !answer.mentioned && answer.error === undefined)
      .slice(0, 5)
      .map((answer) => {
        const refs = answer.citedDomains.slice(0, 2).join(", ") || "无";
        const firstUrl = answer.citedUrls?.[0];
        return `内容缺口:「${answer.question.slice(0, 60)}」引用 ${refs}${firstUrl ? `；页面 ${firstUrl}` : ""}`;
      }),
  };
}

function normalizeCitedUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;

    const candidate = item.trim();
    if (!/^https?:\/\//i.test(candidate) || seen.has(candidate)) continue;

    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) continue;
    } catch {
      continue;
    }

    seen.add(candidate);
    urls.push(candidate);
    if (urls.length === 20) break;
  }
  return urls;
}

function domainFromUrl(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function mergeDomains(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const domain of groups.flat()) {
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

function comparableDomain(value: string): string {
  const normalized = normalizeDomain(value);
  if (!normalized) return "";

  try {
    return new URL(`https://${normalized}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalized.split("/", 1)[0]?.replace(/^www\./, "") ?? "";
  }
}

function domainMatches(domain: string, brandDomain: string): boolean {
  return domain === brandDomain || domain.endsWith(`.${brandDomain}`);
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const domains: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;

    const domain = normalizeDomain(item);
    if (!domain || seen.has(domain)) continue;

    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "");
}
