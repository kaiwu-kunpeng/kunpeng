import { normalizeUrl, type CrawlPage } from "./crawl.js";

function parseLocations(xml: string, entry: "url" | "sitemap"): string[] {
  const urls = new Set<string>();
  const entries = new RegExp(`<${entry}\\b[^>]*>([\\s\\S]*?)<\\/${entry}\\s*>`, "g");
  for (const match of xml.matchAll(entries)) {
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/.exec(match[1]);
    if (loc === null) continue;
    const value = loc[1].trim().replace(/&amp;/g, "&");
    const url = normalizeUrl(value, value);
    if (url !== null) urls.add(url);
  }
  return [...urls];
}

export function parseSitemapUrls(xml: string): string[] {
  return parseLocations(xml, "url");
}

export function parseSitemapIndex(xml: string): string[] {
  return parseLocations(xml, "sitemap");
}

export interface LinkGraphInput {
  pages: CrawlPage[];
  edges: Array<[string, string]>;
  sitemapUrls?: string[];
  startUrl?: string;
  maxDepthOk?: number;
}

export interface LinkGraph {
  inbound: Record<string, number>;
  depth: Record<string, number>;
  orphans: string[];
  notInSitemap: string[];
  broken: Array<{ from: string; to: string; status: number }>;
  deep: string[];
  pageRank: Record<string, number>;
}

function calculatePageRank(outgoing: Map<string, Set<string>>): Record<string, number> {
  const urls = [...outgoing.keys()];
  const count = urls.length;
  if (count === 0) return {};
  const damping = 0.85;
  let ranks: Record<string, number> = Object.fromEntries(urls.map((url) => [url, 1 / count]));
  for (let iteration = 0; iteration < 30; iteration++) {
    let danglingSum = 0;
    for (const [url, links] of outgoing) {
      if (links.size === 0) danglingSum += ranks[url];
    }
    const baseline = (1 - damping) / count + damping * danglingSum / count;
    const next: Record<string, number> = Object.fromEntries(urls.map((url) => [url, baseline]));
    for (const [from, links] of outgoing) {
      if (links.size === 0) continue;
      const share = damping * ranks[from] / links.size;
      for (const to of links) next[to] += share;
    }
    ranks = next;
  }
  return ranks;
}

export function buildLinkGraph(input: LinkGraphInput): LinkGraph {
  const { pages, edges, sitemapUrls, startUrl = pages[0]?.url, maxDepthOk = 3 } = input;
  const graph: LinkGraph = {
    inbound: {}, depth: {}, orphans: [], notInSitemap: [], broken: [], deep: [], pageRank: {},
  };
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const outgoing = new Map<string, Set<string>>();
  for (const page of byUrl.values()) {
    graph.inbound[page.url] = 0;
    graph.depth[page.url] = page.depth;
    outgoing.set(page.url, new Set());
  }

  const seenEdges = new Set<string>();
  for (const [from, to] of edges) {
    const key = JSON.stringify([from, to]);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    if (from !== to) graph.inbound[to] = (graph.inbound[to] ?? 0) + 1;
    const target = byUrl.get(to);
    if (target !== undefined) {
      outgoing.get(from)?.add(to);
      if (target.status >= 400 || target.status === 0) {
        graph.broken.push({ from, to, status: target.status });
      }
    }
  }

  if (sitemapUrls !== undefined) {
    const sitemap = new Set(sitemapUrls);
    graph.orphans = [...sitemap]
      .filter((url) => url !== startUrl && (graph.inbound[url] ?? 0) === 0)
      .sort();
    graph.notInSitemap = [...byUrl.values()]
      .filter((page) => page.status === 200 && page.contentType.includes("text/html") && !sitemap.has(page.url))
      .map((page) => page.url)
      .sort();
  }
  graph.deep = [...byUrl.values()]
    .filter((page) => page.depth > maxDepthOk)
    .map((page) => page.url)
    .sort();
  graph.pageRank = calculatePageRank(outgoing);
  return graph;
}
