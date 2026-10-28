import { describe, expect, test } from "vitest";
import { crawlSite, extractLinks, isDisallowed, normalizeUrl, parseRobotsDisallow, type CrawlPage } from "../../src/seo/crawl.js";
import { buildLinkGraph, parseSitemapIndex, parseSitemapUrls } from "../../src/seo/link-graph.js";

const ORIGIN = "https://demo-travel.ai";
const page = (title: string, links: string[]) =>
  `<html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; throw?: string }> = {
  "/robots.txt": { body: "# demo\nUser-agent: Googlebot\nDisallow: /nothing-for-google\n\nUser-agent: *\nDisallow: /private\nDisallow: /api/\nAllow: /api/public\n" },
  "/": { body: page("Home", ["/a", "/b", "/c#frag", "/d/", "/private/secret", "/blog.pdf", "https://other.example/x", "/boom", "mailto:x@demo-travel.ai", "/a"]) },
  "/a": { body: page("A", ["/b", "/deep1"]) },
  "/b": { body: page("B", ["/a", "/missing"]) },
  "/c": { body: page("C", []) },
  "/d": { body: page("D", ["/"]) },
  "/deep1": { body: page("Deep1", ["/deep2"]) },
  "/deep2": { body: page("Deep2", ["/deep3"]) },
  "/deep3": { body: page("Deep3", ["/deep4"]) },
  "/deep4": { body: page("Deep4", []) },
  "/blog.pdf": { type: "application/pdf", body: "%PDF-1.4" },
  "/missing": { status: 404, body: "nope" },
  "/boom": { throw: "socket hang up" },
  "/orphan": { body: page("Orphan", []) },
};

const seen: Array<{ url: string; ua: string | undefined }> = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  seen.push({ url: url.toString(), ua: headers.get("user-agent") ?? undefined });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  if (entry.throw !== undefined) throw new Error(entry.throw);
  return new Response(entry.body ?? "", {
    status: entry.status ?? 200,
    headers: { "content-type": entry.type ?? "text/html; charset=utf-8" },
  });
}) as unknown as typeof fetch;

describe("normalizeUrl / robots / extractLinks(作者锁定)", () => {
  test("归一化:去 hash、去末尾斜杠、保留查询串、非 http 为 null", () => {
    expect(normalizeUrl("/a/", ORIGIN)).toBe(`${ORIGIN}/a`);
    expect(normalizeUrl("/c#frag", ORIGIN)).toBe(`${ORIGIN}/c`);
    expect(normalizeUrl("/", ORIGIN)).toBe(`${ORIGIN}/`);
    expect(normalizeUrl(`${ORIGIN}`, ORIGIN)).toBe(`${ORIGIN}/`);
    expect(normalizeUrl("/s?q=1&p=2", ORIGIN)).toBe(`${ORIGIN}/s?q=1&p=2`);
    expect(normalizeUrl("mailto:x@demo-travel.ai", ORIGIN)).toBeNull();
    expect(normalizeUrl("javascript:void(0)", ORIGIN)).toBeNull();
    expect(normalizeUrl("http://[bad", ORIGIN)).toBeNull();
  });

  test("robots:只取 * 与匹配 UA 的组,Allow 忽略,注释忽略", () => {
    const txt = SITE["/robots.txt"].body!;
    expect(parseRobotsDisallow(txt, "kunpeng-seo/0.1")).toEqual(["/private", "/api/"]);
    expect(parseRobotsDisallow(txt, "Mozilla/5.0 (compatible; Googlebot/2.1)")).toEqual(["/nothing-for-google", "/private", "/api/"]);
    expect(parseRobotsDisallow("User-agent: *\nDisallow:\n", "x")).toEqual([]);
    expect(isDisallowed("/private/secret", ["/private", "/api/"])).toBe(true);
    expect(isDisallowed("/api/public", ["/private", "/api/"])).toBe(true);
    expect(isDisallowed("/apiary", ["/api/"])).toBe(false);
    expect(isDisallowed("/a", [])).toBe(false);
  });

  test("extractLinks:同源、归一化、去重保序", () => {
    expect(extractLinks(SITE["/"].body!, `${ORIGIN}/`)).toEqual([
      `${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`, `${ORIGIN}/d`, `${ORIGIN}/private/secret`, `${ORIGIN}/blog.pdf`, `${ORIGIN}/boom`,
    ]);
  });
});

describe("crawlSite(作者锁定)", () => {
  test("BFS 全站:状态码、深度、出链、robots 拦截、非 HTML、抓取异常", async () => {
    seen.length = 0;
    const r = await crawlSite({ startUrl: `${ORIGIN}`, fetchImpl });
    expect(r.startUrl).toBe(`${ORIGIN}/`);
    expect(seen[0]).toEqual({ url: `${ORIGIN}/robots.txt`, ua: "kunpeng-seo/0.1" });
    expect(seen[1].url).toBe(`${ORIGIN}/`);
    expect(r.blockedByRobots).toEqual([`${ORIGIN}/private/secret`]);

    const byUrl = new Map(r.pages.map((p) => [p.url, p]));
    expect(r.pages[0]).toMatchObject({ url: `${ORIGIN}/`, status: 200, depth: 0, title: "Home" });
    expect(r.pages[0].links).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`, `${ORIGIN}/d`, `${ORIGIN}/private/secret`, `${ORIGIN}/blog.pdf`, `${ORIGIN}/boom`]);
    expect(byUrl.get(`${ORIGIN}/a`)).toMatchObject({ depth: 1, links: [`${ORIGIN}/b`, `${ORIGIN}/deep1`] });
    expect(byUrl.get(`${ORIGIN}/deep4`)?.depth).toBe(5);
    expect(byUrl.get(`${ORIGIN}/missing`)).toMatchObject({ status: 404, depth: 2, links: [] });
    expect(byUrl.get(`${ORIGIN}/blog.pdf`)).toMatchObject({ status: 200, contentType: "application/pdf", title: null, links: [] });
    expect(byUrl.get(`${ORIGIN}/boom`)).toMatchObject({ status: 0, error: "socket hang up", links: [] });
    expect(byUrl.has(`${ORIGIN}/private/secret`)).toBe(false);
    expect(byUrl.has(`${ORIGIN}/orphan`)).toBe(false);
    expect(byUrl.has("https://other.example/x")).toBe(false);
    expect(r.pages).toHaveLength(12);
    expect(r.edges).toContainEqual([`${ORIGIN}/`, `${ORIGIN}/private/secret`]);
    expect(r.edges).toContainEqual([`${ORIGIN}/b`, `${ORIGIN}/missing`]);
    expect(r.edges.filter(([from]) => from === `${ORIGIN}/`)).toHaveLength(7);
  });

  test("maxPages / maxDepth / respectRobots=false", async () => {
    const small = await crawlSite({ startUrl: `${ORIGIN}/`, fetchImpl, maxPages: 3 });
    expect(small.pages).toHaveLength(3);
    expect(small.pages.map((p) => p.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/a`, `${ORIGIN}/b`]);

    const shallow = await crawlSite({ startUrl: `${ORIGIN}/`, fetchImpl, maxDepth: 1 });
    expect(Math.max(...shallow.pages.map((p) => p.depth))).toBe(1);
    expect(shallow.pages.some((p) => p.url === `${ORIGIN}/deep1`)).toBe(false);

    seen.length = 0;
    const noRobots = await crawlSite({ startUrl: `${ORIGIN}/`, fetchImpl, respectRobots: false, userAgent: "DemoBot/9" });
    expect(seen.some((s) => s.url.endsWith("/robots.txt"))).toBe(false);
    expect(seen[0].ua).toBe("DemoBot/9");
    expect(noRobots.blockedByRobots).toEqual([]);
    expect(noRobots.pages.some((p) => p.url === `${ORIGIN}/private/secret`)).toBe(true);
  });
});

describe("buildLinkGraph / sitemap(作者锁定)", () => {
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}/</loc><lastmod>2026-09-01</lastmod></url>
  <url><loc>${ORIGIN}/a/</loc></url>
  <url><loc>${ORIGIN}/b</loc></url>
  <url><loc>${ORIGIN}/d</loc></url>
  <url><loc>${ORIGIN}/orphan</loc></url>
  <url><loc>${ORIGIN}/deep1</loc></url>
  <url><loc>${ORIGIN}/deep2</loc></url>
  <url><loc>${ORIGIN}/deep3</loc></url>
  <url><loc>${ORIGIN}/deep4</loc></url>
  <url><loc>${ORIGIN}/s?q=1&amp;p=2</loc></url>
  <url><loc>${ORIGIN}/b</loc></url>
</urlset>`;

  test("parseSitemapUrls / parseSitemapIndex", () => {
    expect(parseSitemapUrls(sitemapXml)).toEqual([
      `${ORIGIN}/`, `${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/d`, `${ORIGIN}/orphan`,
      `${ORIGIN}/deep1`, `${ORIGIN}/deep2`, `${ORIGIN}/deep3`, `${ORIGIN}/deep4`, `${ORIGIN}/s?q=1&p=2`,
    ]);
    const index = `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-1.xml</loc></sitemap><sitemap><loc>${ORIGIN}/sitemap-2.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemapIndex(index)).toEqual([`${ORIGIN}/sitemap-1.xml`, `${ORIGIN}/sitemap-2.xml`]);
    expect(parseSitemapUrls(index)).toEqual([]);
  });

  test("入链/深度/孤儿/漏列/断链/深页/PageRank", async () => {
    const r = await crawlSite({ startUrl: `${ORIGIN}/`, fetchImpl });
    const g = buildLinkGraph({ pages: r.pages, edges: r.edges, sitemapUrls: parseSitemapUrls(sitemapXml) });
    expect(g.inbound[`${ORIGIN}/`]).toBe(1);
    expect(g.inbound[`${ORIGIN}/a`]).toBe(2);
    expect(g.inbound[`${ORIGIN}/orphan`] ?? 0).toBe(0);
    expect(g.inbound[`${ORIGIN}/private/secret`]).toBe(1);
    expect(g.depth[`${ORIGIN}/deep3`]).toBe(4);
    expect(g.orphans).toEqual([`${ORIGIN}/orphan`, `${ORIGIN}/s?q=1&p=2`]);
    expect(g.notInSitemap).toEqual([`${ORIGIN}/c`]);
    expect(g.broken).toEqual([
      { from: `${ORIGIN}/`, to: `${ORIGIN}/boom`, status: 0 },
      { from: `${ORIGIN}/b`, to: `${ORIGIN}/missing`, status: 404 },
    ]);
    expect(g.deep).toEqual([`${ORIGIN}/deep3`, `${ORIGIN}/deep4`]);
    const sum = Object.values(g.pageRank).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    expect(Object.keys(g.pageRank)).toHaveLength(r.pages.length);
    expect(g.pageRank[`${ORIGIN}/a`]).toBeGreaterThan(g.pageRank[`${ORIGIN}/c`]);
    expect(g.pageRank[`${ORIGIN}/a`]).toBeGreaterThan(g.pageRank[`${ORIGIN}/d`]);
  });

  test("无 sitemap 时孤儿与漏列为空;空图返回空 PageRank", () => {
    const pages: CrawlPage[] = [
      { url: `${ORIGIN}/`, status: 200, depth: 0, contentType: "text/html", title: "Home", links: [`${ORIGIN}/x`] },
      { url: `${ORIGIN}/x`, status: 200, depth: 1, contentType: "text/html", title: "X", links: [] },
    ];
    const g = buildLinkGraph({ pages, edges: [[`${ORIGIN}/`, `${ORIGIN}/x`]] });
    expect(g.orphans).toEqual([]);
    expect(g.notInSitemap).toEqual([]);
    expect(g.inbound).toEqual({ [`${ORIGIN}/`]: 0, [`${ORIGIN}/x`]: 1 });
    expect(g.pageRank[`${ORIGIN}/x`]).toBeGreaterThan(g.pageRank[`${ORIGIN}/`]);
    expect(buildLinkGraph({ pages: [], edges: [] }).pageRank).toEqual({});
  });
});