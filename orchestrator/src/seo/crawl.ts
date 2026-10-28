import { load } from "cheerio";
import { isAllowedByRobots, parseRobotsGroups } from "./gates/robots-classes.js";

export function normalizeUrl(href: string, base: string): string | null {
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

export function parseRobotsDisallow(text: string, userAgent: string): string[] {
  const disallow = new Set<string>();
  const agent = userAgent.toLowerCase();
  let matches = false;
  let hasDirectives = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (hasDirectives) matches = false;
      hasDirectives = false;
      matches = matches || value === "*" || (value !== "" && agent.includes(value.toLowerCase()));
    } else {
      hasDirectives = true;
      if (field === "disallow" && matches && value !== "") disallow.add(value);
    }
  }
  return [...disallow];
}

export function isDisallowed(pathname: string, disallow: string[]): boolean {
  return disallow.some((prefix) => pathname.startsWith(prefix));
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const origin = new URL(baseUrl).origin;
  const links = new Set<string>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (href === undefined) return;
    const url = normalizeUrl(href, baseUrl);
    if (url !== null && new URL(url).origin === origin) links.add(url);
  });
  return [...links];
}

export interface CrawlOptions {
  startUrl: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  userAgent?: string;
  respectRobots?: boolean;
  keepHtml?: boolean;
}

export interface CrawlPage {
  url: string;
  finalUrl?: string;
  status: number;
  depth: number;
  contentType: string;
  title: string | null;
  links: string[];
  error?: string;
  html?: string;
}

export interface CrawlResult {
  startUrl: string;
  pages: CrawlPage[];
  edges: Array<[string, string]>;
  blockedByRobots: string[];
}

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const startUrl = normalizeUrl(opts.startUrl, opts.startUrl);
  if (startUrl === null) throw new TypeError("startUrl must be an HTTP(S) URL");
  const {
    fetchImpl = fetch,
    maxPages = 500,
    maxDepth = 10,
    userAgent = "kunpeng-seo/0.1",
    respectRobots = true,
    keepHtml = false,
  } = opts;
  const concurrency = Math.max(1, Math.min(16, Math.floor(opts.concurrency ?? 1) || 1));
  const origin = new URL(startUrl).origin;
  const headers = { "user-agent": userAgent };
  let robots = parseRobotsGroups("");
  if (respectRobots) {
    try {
      const response = await fetchImpl(`${origin}/robots.txt`, { headers });
      if (response.status === 200) {
        robots = parseRobotsGroups(await response.text());
      }
    } catch {
      // The crawl contract treats an unavailable robots.txt as having no rules.
      robots = parseRobotsGroups("");
    }
  }

  async function fetchPage({ url, depth }: { url: string; depth: number }): Promise<CrawlPage> {
    let finalUrl: string | null = null;
    try {
      const response = await fetchImpl(url, { headers, redirect: "follow" });
      const responseUrl = response.url ? normalizeUrl(response.url, url) : null;
      finalUrl = responseUrl === url ? null : responseUrl;
      const contentType = response.headers.get("content-type") ?? "";
      const page: CrawlPage = { url, status: response.status, depth, contentType, title: null, links: [] };
      if (finalUrl !== null) page.finalUrl = finalUrl;
      if (page.status === 200 && contentType.includes("text/html")) {
        const html = await response.text();
        page.title = load(html)("title").first().text().trim() || null;
        page.links = extractLinks(html, page.finalUrl ?? url);
        if (keepHtml) page.html = html;
      }
      return page;
    } catch (error) {
      return {
        url, status: 0, depth, contentType: "", title: null, links: [],
        error: String(error instanceof Error ? error.message : error),
        ...(finalUrl === null ? {} : { finalUrl }),
      };
    }
  }

  const result: CrawlResult = { startUrl, pages: [], edges: [], blockedByRobots: [] };
  const blocked = new Set<string>();
  const visited = new Set([startUrl]);
  const queue = [{ url: startUrl, depth: 0 }];
  function allowed(url: string): boolean {
    const parsed = new URL(url);
    return isAllowedByRobots(robots, userAgent, parsed.pathname + parsed.search);
  }
  function enqueue(url: string, depth: number): void {
    if (visited.has(url) || depth > maxDepth || new URL(url).origin !== origin) return;
    if (!allowed(url)) {
      blocked.add(url);
    } else {
      visited.add(url);
      queue.push({ url, depth });
    }
  }

  let index = 0;
  while (index < queue.length && result.pages.length < maxPages) {
    const batch: Array<{ url: string; depth: number }> = [];
    while (index < queue.length && batch.length < concurrency && result.pages.length + batch.length < maxPages) {
      const item = queue[index++];
      // A blocked start URL (or queued URL) does not spend the page budget.
      if (!allowed(item.url)) blocked.add(item.url);
      else batch.push(item);
    }
    // Fetch concurrently; only ordered processing may mutate the crawl graph and queue.
    const pages = await Promise.all(batch.map(fetchPage));
    for (const page of pages) {
      result.pages.push(page);
      if (page.finalUrl !== undefined) enqueue(page.finalUrl, page.depth);
      for (const link of page.links) {
        result.edges.push([page.url, link]);
        enqueue(link, page.depth + 1);
      }
    }
  }
  result.blockedByRobots = [...blocked];
  return result;
}
