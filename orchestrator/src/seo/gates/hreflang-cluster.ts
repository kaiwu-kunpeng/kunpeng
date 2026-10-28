import * as cheerio from "cheerio";
import { normalizeUrl } from "../crawl.js";
import type { Finding } from "../page-audit.js";

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const scriptNames = new Intl.DisplayNames(["en"], { type: "script", fallback: "none" });
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const excludedRegions = new Set(["UK", "EU", "UN", "EZ", "ZZ", "QO"]);

export function isValidHreflang(code: string): boolean {
  if (code.toLowerCase() === "x-default") return true;
  const parts = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}))?$/i.exec(code);
  if (parts === null) return false;
  const [, language, script, region] = parts;
  if (languageNames.of(language.toLowerCase()) === undefined) return false;
  if (script !== undefined) {
    const normalized = script[0].toUpperCase() + script.slice(1).toLowerCase();
    if (scriptNames.of(normalized) === undefined) return false;
  }
  if (region !== undefined) {
    const normalized = region.toUpperCase();
    if (excludedRegions.has(normalized) || regionNames.of(normalized) === undefined) return false;
  }
  return true;
}

export function extractHreflangLinks(html: string, pageUrl: string): Array<{ lang: string; href: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ lang: string; href: string }> = [];
  $('link[rel~="alternate"][hreflang]').each((_index, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href) return;
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized !== null) links.push({ lang: $(element).attr("hreflang")!.trim(), href: normalized });
  });
  return links;
}

interface HreflangPage {
  status: number;
  html?: string;
  location?: string;
}

interface HreflangClusterResult {
  ok: boolean;
  checkedPages: number;
  findings: Finding[];
}

function normalizedSeeds(urls: string[]): string[] {
  return [...new Set(urls.map((url) => normalizeUrl(url, url)).filter((url): url is string => url !== null))];
}

export function checkHreflangCluster(input: {
  seeds: string[];
  pages: Record<string, HreflangPage>;
}): HreflangClusterResult {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  let checkedPages = 0;
  const report = (rule: string, severity: Finding["severity"], evidence: string, message: string): void => {
    const key = `${rule}:${evidence}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({ rule, severity, evidence, message });
  };

  for (const seed of normalizedSeeds(input.seeds)) {
    const page = input.pages[seed];
    if (page?.status !== 200 || page.html === undefined) continue;
    checkedPages++;
    const destinations = new Map<string, string>();
    for (const { lang, href } of extractHreflangLinks(page.html, seed)) {
      const code = lang.toLowerCase();
      const valid = isValidHreflang(lang);
      if (!valid) {
        report("hreflang-invalid-code", "error", `${seed} ${lang}`, `${seed}: invalid hreflang code "${lang}".`);
      }
      const previous = destinations.get(code);
      if (previous !== undefined && previous !== href) {
        report("hreflang-duplicate-code", "error", `${seed} ${code}`, `${seed}: hreflang "${code}" points to multiple URLs.`);
      }
      destinations.set(code, href);

      if (href === seed) continue;
      const target = input.pages[href];
      if (target === undefined) continue;
      const evidence = `${seed} -> ${href}`;
      if (target.status >= 300 && target.status < 400) {
        report("hreflang-target-redirect", "error", evidence, `${evidence}: target redirects (HTTP ${target.status}).`);
        continue;
      }
      if (target.status !== 200) {
        report("hreflang-target-status", "error", evidence, `${evidence}: target returned status ${target.status}.`);
        continue;
      }

      const targetHtml = target.html ?? "";
      const $ = cheerio.load(targetHtml);
      const canonicalHref = $('link[rel="canonical"]').first().attr("href")?.trim();
      const canonical = canonicalHref ? normalizeUrl(canonicalHref, href) : null;
      if (canonical !== null && canonical !== href) {
        report("hreflang-target-canonical", "error", evidence, `${evidence}: target canonical points to ${canonical}.`);
      }
      if (!extractHreflangLinks(targetHtml, href).some((link) => link.href === seed)) {
        report("hreflang-no-return", "error", evidence, `${evidence}: target has no hreflang link back to ${seed}.`);
      }
      const targetLang = $("html").attr("lang")?.trim().toLowerCase();
      if (valid && code !== "x-default" && targetLang && code.split("-")[0] !== targetLang.split("-")[0]) {
        report("hreflang-lang-mismatch", "warn", evidence, `${evidence}: hreflang "${lang}" differs from target html lang "${targetLang}".`);
      }
    }
  }
  return { ok: !findings.some((finding) => finding.severity === "error"), checkedPages, findings };
}

export async function runHreflangCluster(opts: {
  urls: string[];
  fetchImpl?: typeof fetch;
  userAgent?: string;
  maxTargets?: number;
}): Promise<HreflangClusterResult & { fetched: number }> {
  const { fetchImpl = fetch, userAgent = "kunpeng-seo/0.1", maxTargets = 200 } = opts;
  const seeds = normalizedSeeds(opts.urls);
  const pages: Record<string, HreflangPage> = {};
  let fetched = 0;
  const load = async (url: string): Promise<void> => {
    fetched++;
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": userAgent }, redirect: "manual" });
      const page: HreflangPage = { status: response.status };
      if (response.status === 200) page.html = await response.text();
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location !== null) page.location = location;
      }
      pages[url] = page;
    } catch {
      pages[url] = { status: 0 };
    }
  };

  for (const seed of seeds) await load(seed);
  const targets = new Set<string>();
  for (const seed of seeds) {
    const page = pages[seed];
    if (page.status !== 200 || page.html === undefined) continue;
    for (const { href } of extractHreflangLinks(page.html, seed)) {
      if (pages[href] === undefined) targets.add(href);
    }
  }
  const limit = Number.isFinite(maxTargets) ? Math.max(0, Math.floor(maxTargets)) : 200;
  for (const target of [...targets].slice(0, limit)) await load(target);
  return { ...checkHreflangCluster({ seeds, pages }), fetched };
}
