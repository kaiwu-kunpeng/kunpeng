import { load } from "cheerio";
import { normalizeUrl } from "../crawl.js";
import type { Finding } from "../page-audit.js";

export type DiscoverySource = "llms.txt" | "robots.txt" | "link-header" | "json-ld";

export interface DiscoveryUrl {
  url: string;
  source: DiscoverySource;
}

export interface DiscoveryProbe {
  url: string;
  source: DiscoverySource;
  status: number;
  ok: boolean;
}

export interface DiscoveryLivenessInput {
  origin: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  includeExternal?: boolean;
  maxUrls?: number;
}

export interface DiscoveryLivenessResult {
  ok: boolean;
  findings: Finding[];
  probes: DiscoveryProbe[];
  sources: Record<DiscoverySource, number>;
  skippedExternal: string[];
}

function normalizeDiscoveryUrls(rawUrls: string[], base: string, source: DiscoverySource): DiscoveryUrl[] {
  const seen = new Set<string>();
  const urls: DiscoveryUrl[] = [];
  for (const raw of rawUrls) {
    const url = normalizeUrl(raw, base);
    if (url === null || seen.has(url)) continue;
    seen.add(url);
    urls.push({ url, source });
  }
  return urls;
}

export function extractUrlsFromText(text: string, base: string, source: DiscoverySource): DiscoveryUrl[] {
  const rawUrls: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()"']+/g)) {
    rawUrls.push(match[0].replace(/[.,;:!?)]+$/, ""));
  }
  for (const match of text.matchAll(/\]\((\/[^\s)]*)\)/g)) {
    rawUrls.push(match[1]);
  }
  return normalizeDiscoveryUrls(rawUrls, base, source);
}

export function extractSitemapsFromRobots(text: string, base: string): DiscoveryUrl[] {
  const rawUrls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*sitemap:\s*(\S.*?)\s*$/i.exec(line);
    if (match !== null) rawUrls.push(match[1]);
  }
  return normalizeDiscoveryUrls(rawUrls, base, "robots.txt");
}

export function extractUrlsFromLinkHeader(header: string, base: string): DiscoveryUrl[] {
  const rawUrls: string[] = [];
  for (const item of header.split(",")) {
    const match = /<([^>]+)>/.exec(item);
    if (match !== null) rawUrls.push(match[1]);
  }
  return normalizeDiscoveryUrls(rawUrls, base, "link-header");
}

const JSON_LD_URL_KEYS = new Set([
  "url", "@id", "logo", "image", "sameAs", "contentUrl", "thumbnailUrl", "mainEntityOfPage", "item",
]);

export function extractUrlsFromJsonLd(html: string, base: string): DiscoveryUrl[] {
  const rawUrls: string[] = [];
  const visit = (value: unknown, collectStrings = false): void => {
    if (typeof value === "string") {
      if (collectStrings && /^(https?:\/\/|\/)/.test(value)) rawUrls.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, collectStrings);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        visit(child, JSON_LD_URL_KEYS.has(key));
      }
    }
  };

  const $ = load(html);
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let value: unknown;
    try {
      value = JSON.parse($(script).text());
    } catch {
      // A malformed block must not hide URLs from the remaining blocks.
      continue;
    }
    visit(value);
  }
  return normalizeDiscoveryUrls(rawUrls, base, "json-ld");
}

export async function runDiscoveryLiveness(input: DiscoveryLivenessInput): Promise<DiscoveryLivenessResult> {
  const origin = new URL(input.origin).origin;
  const {
    fetchImpl = fetch,
    userAgent = "kunpeng-seo/0.1",
    includeExternal = false,
    maxUrls = 200,
  } = input;
  const requestInit: RequestInit = {
    method: "GET",
    headers: { "user-agent": userAgent },
    redirect: "follow",
  };
  const findings: Finding[] = [];
  const discovered: DiscoveryUrl[] = [];
  const entryPaths = ["/llms.txt", "/robots.txt", "/"];
  const unreachable = (url: string, status: number): void => {
    findings.push({
      rule: "discovery-source-unreachable",
      severity: "warn",
      message: `Discovery source is unreachable (status ${status}).`,
      evidence: url,
    });
  };

  for (const path of entryPaths) {
    const url = `${origin}${path}`;
    try {
      const response = await fetchImpl(url, requestInit);
      if (response.status === 200) {
        const text = await response.text();
        if (path === "/llms.txt") {
          discovered.push(...extractUrlsFromText(text, origin, "llms.txt"));
        } else if (path === "/robots.txt") {
          discovered.push(...extractSitemapsFromRobots(text, origin));
        } else {
          discovered.push(...extractUrlsFromLinkHeader(response.headers.get("link") ?? "", origin));
          discovered.push(...extractUrlsFromJsonLd(text, origin));
        }
      } else if (response.status === 404 && path === "/llms.txt") {
        findings.push({
          rule: "discovery-llms-missing",
          severity: "info",
          message: "Discovery source llms.txt is missing.",
          evidence: url,
        });
      } else if (!(response.status === 404 && path === "/robots.txt")) {
        unreachable(url, response.status);
      }
    } catch {
      unreachable(url, 0);
    }
  }

  const seen = new Set(entryPaths.map((path) => `${origin}${path}`));
  const skippedExternal: string[] = [];
  const candidates: DiscoveryUrl[] = [];
  for (const entry of discovered) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    if (includeExternal !== true && new URL(entry.url).origin !== origin) {
      skippedExternal.push(entry.url);
    } else {
      candidates.push(entry);
    }
  }

  const probes: DiscoveryProbe[] = [];
  const sources: Record<DiscoverySource, number> = {
    "llms.txt": 0, "robots.txt": 0, "link-header": 0, "json-ld": 0,
  };
  for (const entry of candidates.slice(0, Math.max(0, maxUrls))) {
    let status: number;
    try {
      status = (await fetchImpl(entry.url, requestInit)).status;
    } catch {
      // Transport failures are reported as status 0, alongside HTTP failures.
      status = 0;
    }
    const ok = status >= 200 && status < 300;
    probes.push({ ...entry, status, ok });
    sources[entry.source] += 1;
    if (!ok) {
      findings.push({
        rule: "discovery-dead-url",
        severity: "error",
        message: `Discovery URL from ${entry.source} failed (status ${status}).`,
        evidence: entry.url,
      });
    }
  }
  if (probes.length === 0) {
    findings.push({
      rule: "discovery-empty",
      severity: "warn",
      message: "No discovery URLs are available to probe.",
    });
  }
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings, probes, sources, skippedExternal,
  };
}
