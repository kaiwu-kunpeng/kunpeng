import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractLinks, normalizeUrl, type CrawlPage } from "../crawl.js";
import { buildLinkGraph } from "../link-graph.js";
import type { Finding } from "../page-audit.js";

export interface SitemapOrphanGateInput {
  pages: CrawlPage[];
  edges: Array<[string, string]>;
  sitemapUrls: string[];
  startUrl?: string;
  allow?: string[];
  maxDepthOk?: number;
}

export interface SitemapOrphanGateResult {
  ok: boolean;
  findings: Finding[];
  orphans: string[];
  ignored: string[];
  notInSitemap: string[];
  deep: string[];
  sitemapCount: number;
  linkedCount: number;
}

export function runSitemapOrphanGate(input: SitemapOrphanGateInput): SitemapOrphanGateResult {
  const { pages, edges, sitemapUrls, startUrl = pages[0]?.url, allow = [], maxDepthOk = 3 } = input;
  const graph = buildLinkGraph({ pages, edges, sitemapUrls, startUrl, maxDepthOk });
  const orphans: string[] = [];
  const ignored: string[] = [];
  for (const url of graph.orphans) {
    const pathname = new URL(url).pathname;
    (allow.some((prefix) => pathname.startsWith(prefix)) ? ignored : orphans).push(url);
  }

  const { notInSitemap, deep } = graph;
  const findings: Finding[] = [];
  if (sitemapUrls.length === 0) {
    findings.push({ rule: "sitemap-empty", severity: "error", message: "Sitemap contains no URLs." });
  }
  for (const url of orphans) {
    findings.push({
      rule: "sitemap-orphan", severity: "error",
      message: `Sitemap URL has no inbound links: ${url}`, evidence: url,
    });
  }
  if (notInSitemap.length > 0) {
    findings.push({
      rule: "not-in-sitemap", severity: "warn",
      message: `${notInSitemap.length} pages are missing from the sitemap.`,
      evidence: notInSitemap.slice(0, 10).join(", "),
    });
  }
  if (deep.length > 0) {
    findings.push({
      rule: "deep-page", severity: "warn",
      message: `${deep.length} pages exceed the maximum depth of ${maxDepthOk}.`,
      evidence: deep.slice(0, 10).join(", "),
    });
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings, orphans, ignored, notInSitemap, deep,
    sitemapCount: sitemapUrls.length,
    linkedCount: sitemapUrls.filter((url) => url === startUrl || (graph.inbound[url] ?? 0) > 0).length,
  };
}

export function htmlFileToPath(relativeFile: string): string | null {
  if (!relativeFile.endsWith(".html")) return null;
  const segments = relativeFile.split("/");
  if (segments.some((segment) => segment.startsWith("_") || segment.includes("["))) return null;
  const route = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  route[route.length - 1] = route[route.length - 1].slice(0, -".html".length);
  if (route[route.length - 1] === "index") route.pop();
  return `/${route.join("/")}`;
}

export function linkGraphFromHtmlDir(dir: string, origin: string): {
  pages: CrawlPage[];
  edges: Array<[string, string]>;
} {
  const pages: CrawlPage[] = [];
  const edges: Array<[string, string]> = [];
  function visit(relativeDir: string): void {
    for (const name of readdirSync(join(dir, relativeDir))) {
      const relativeFile = relativeDir ? `${relativeDir}/${name}` : name;
      const file = join(dir, relativeFile);
      const stat = statSync(file);
      if (stat.isDirectory()) {
        visit(relativeFile);
        continue;
      }
      if (!stat.isFile()) continue;
      const path = htmlFileToPath(relativeFile);
      if (path === null) continue;
      const url = normalizeUrl(path, origin);
      if (url === null) continue;
      const html = readFileSync(file, "utf8");
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() || null;
      const links = extractLinks(html, url);
      pages.push({ url, status: 200, depth: -1, contentType: "text/html", title, links });
      for (const link of links) edges.push([url, link]);
    }
  }
  visit("");

  const outgoing = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const links = outgoing.get(from);
    if (links === undefined) outgoing.set(from, [to]);
    else links.push(to);
  }
  const depths = new Map<string, number>();
  const startUrl = normalizeUrl("/", origin);
  if (startUrl !== null) {
    depths.set(startUrl, 0);
    const queue = [{ url: startUrl, depth: 0 }];
    for (let index = 0; index < queue.length; index++) {
      const { url, depth } = queue[index];
      for (const link of outgoing.get(url) ?? []) {
        if (depths.has(link)) continue;
        depths.set(link, depth + 1);
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }
  for (const page of pages) page.depth = depths.get(page.url) ?? -1;
  pages.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  return { pages, edges };
}
