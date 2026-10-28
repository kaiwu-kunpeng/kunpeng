import { describe, expect, test, vi } from "vitest";
import {
  extractSitemapsFromRobots,
  extractUrlsFromJsonLd,
  extractUrlsFromLinkHeader,
  extractUrlsFromText,
  runDiscoveryLiveness,
} from "../../src/seo/gates/discovery-liveness.js";

const ORIGIN = "https://demo-travel.ai";
const HOME = `<html><head><title>DemoTravel</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","@id":"${ORIGIN}/#organization","url":"${ORIGIN}/","logo":{"@type":"ImageObject","url":"/icon.png"},"sameAs":["https://social.example/demo-travel","${ORIGIN}/about"]},
 {"@type":"WebSite","@id":"${ORIGIN}/#website","url":"${ORIGIN}/","image":"${ORIGIN}/og.jpg","mainEntityOfPage":{"@id":"${ORIGIN}/guides/"}},
 {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":"${ORIGIN}/guides/alipay-setup#top"}]}
]}</script><script type="application/ld+json">{broken</script></head><body></body></html>`;

const LLMS = `# DemoTravel\n\n- [Alipay setup](/guides/alipay-setup): the guide.\n- [Sources](${ORIGIN}/sources). See also https://demo-travel.ai/answers.json, and ${ORIGIN}/dead-page.\n`;
const ROBOTS = `User-agent: *\nAllow: /\nsitemap: ${ORIGIN}/sitemap.xml\nSitemap: ${ORIGIN}/sitemap-news.xml\n`;

const SITE: Record<string, { status?: number; body?: string; throw?: string; link?: string }> = {
  "/llms.txt": { body: LLMS },
  "/robots.txt": { body: ROBOTS },
  "/": { body: HOME, link: `<${ORIGIN}/route-index.json>; rel="alternate"; type="application/json", </planning-index.txt>; rel="alternate"` },
  "/guides/alipay-setup": { body: "ok" },
  "/sources": { body: "ok" },
  "/answers.json": { body: "{}" },
  "/dead-page": { status: 404 },
  "/sitemap.xml": { body: "<urlset/>" },
  "/sitemap-news.xml": { status: 500 },
  "/route-index.json": { body: "{}" },
  "/planning-index.txt": { body: "ok" },
  "/icon.png": { status: 404 },
  "/og.jpg": { body: "jpg" },
  "/guides": { body: "ok" },
  "/about": { throw: "socket hang up" },
};

const seen: string[] = [];
const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  seen.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.host}${url.pathname}`);
  if (url.host !== "demo-travel.ai") return new Response("external ok", { status: 200 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("nf", { status: 404 });
  if (entry.throw !== undefined) throw new Error(entry.throw);
  const headers: Record<string, string> = { "content-type": "text/html" };
  if (entry.link !== undefined) headers.link = entry.link;
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers });
}) as unknown as typeof fetch;

describe("D5 发现层存活门(作者锁定)", () => {
  test("四个抽取器", () => {
    expect(extractUrlsFromText(LLMS, ORIGIN, "llms.txt").map((u) => u.url)).toEqual([
      `${ORIGIN}/sources`, `${ORIGIN}/answers.json`, `${ORIGIN}/dead-page`, `${ORIGIN}/guides/alipay-setup`,
    ]);
    expect(extractUrlsFromText(LLMS, ORIGIN, "llms.txt").every((u) => u.source === "llms.txt")).toBe(true);
    expect(extractSitemapsFromRobots(ROBOTS, ORIGIN)).toEqual([
      { url: `${ORIGIN}/sitemap.xml`, source: "robots.txt" },
      { url: `${ORIGIN}/sitemap-news.xml`, source: "robots.txt" },
    ]);
    expect(extractUrlsFromLinkHeader(SITE["/"].link!, ORIGIN)).toEqual([
      { url: `${ORIGIN}/route-index.json`, source: "link-header" },
      { url: `${ORIGIN}/planning-index.txt`, source: "link-header" },
    ]);
    expect(extractUrlsFromLinkHeader("", ORIGIN)).toEqual([]);
    const ld = extractUrlsFromJsonLd(HOME, ORIGIN).map((u) => u.url);
    expect(new Set(ld)).toEqual(new Set([
      `${ORIGIN}/`, `${ORIGIN}/icon.png`, "https://social.example/demo-travel", `${ORIGIN}/about`, `${ORIGIN}/og.jpg`, `${ORIGIN}/guides`, `${ORIGIN}/guides/alipay-setup`,
    ]));
    expect(ld).toHaveLength(7);
  });

  test("探活:logo 404、sitemap-news 500、dead-page 404、about 抛错 → 四条 error;外链默认跳过", async () => {
    seen.length = 0;
    const r = await runDiscoveryLiveness({ origin: `${ORIGIN}/some/path`, fetchImpl, userAgent: "DemoBot/3" });
    expect(seen[0]).toBe("DemoBot/3 demo-travel.ai/llms.txt");
    expect(seen.some((s) => s.includes("social.example"))).toBe(false);
    expect(r.skippedExternal).toEqual(["https://social.example/demo-travel"]);
    expect(r.sources).toEqual({ "llms.txt": 4, "robots.txt": 2, "link-header": 2, "json-ld": 4 });
    expect(r.probes).toHaveLength(12);
    expect(r.probes.filter((p) => !p.ok).map((p) => [p.url, p.status])).toEqual([
      [`${ORIGIN}/dead-page`, 404],
      [`${ORIGIN}/sitemap-news.xml`, 500],
      [`${ORIGIN}/icon.png`, 404],
      [`${ORIGIN}/about`, 0],
    ]);
    expect(r.ok).toBe(false);
    const dead = r.findings.filter((f) => f.rule === "discovery-dead-url");
    expect(dead).toHaveLength(4);
    expect(dead[2]).toMatchObject({ severity: "error", evidence: `${ORIGIN}/icon.png` });
    expect(dead[2].message).toContain("json-ld");
    expect(dead[2].message).toContain("404");
    expect(r.findings.filter((f) => f.rule !== "discovery-dead-url")).toEqual([]);
  });

  test("includeExternal 探外链;去重保留首个来源;maxUrls 截断", async () => {
    seen.length = 0;
    const r = await runDiscoveryLiveness({ origin: ORIGIN, fetchImpl, includeExternal: true, maxUrls: 5 });
    expect(seen.some((s) => s.includes("social.example"))).toBe(false);
    expect(r.probes).toHaveLength(5);
    expect(r.skippedExternal).toEqual([]);
    const all = await runDiscoveryLiveness({ origin: ORIGIN, fetchImpl, includeExternal: true });
    expect(all.probes).toHaveLength(13);
    expect(all.probes.find((p) => p.url === "https://social.example/demo-travel")).toMatchObject({ source: "json-ld", status: 200, ok: true });
    expect(all.probes.find((p) => p.url === `${ORIGIN}/guides/alipay-setup`)?.source).toBe("llms.txt");
  });

  test("缺 llms.txt 只是 info;首页挂了 warn;什么都抽不到 warn", async () => {
    const bare = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      if (url.pathname === "/") return new Response("boom", { status: 503 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runDiscoveryLiveness({ origin: ORIGIN, fetchImpl: bare });
    expect(r.ok).toBe(true);
    expect(r.probes).toEqual([]);
    expect(r.sources).toEqual({ "llms.txt": 0, "robots.txt": 0, "link-header": 0, "json-ld": 0 });
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["discovery-llms-missing", "info"],
      ["discovery-source-unreachable", "warn"],
      ["discovery-empty", "warn"],
    ]);
    expect(r.findings[1].evidence).toBe(`${ORIGIN}/`);
  });
});