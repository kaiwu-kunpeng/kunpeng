import { describe, expect, test } from "vitest";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ORIGIN = "https://demo-travel.ai";
const html = (title: string, links: string[], extra = "") =>
  `<html lang="en"><head><meta charset="utf-8"><title>${title} guide page for DemoTravel</title><meta name="description" content="${"d".repeat(120)}"><link rel="canonical" href="${ORIGIN}/${title.toLowerCase()}">${extra}</head><body><h1>${title}</h1>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; throw?: string }> = {
  "/robots.txt": { body: "User-agent: *\nDisallow: /private\n" },
  "/": { body: html("Home", ["/a", "/b", "/private/x", "/gone"]) },
  "/a": { body: html("A", ["/b"]) },
  "/b": { body: html("B", ["/a"]) },
  "/gone": { status: 404, body: "nope" },
  "/orphan": { body: html("Orphan", []) },
  "/bad": { body: `<html><head><meta charset="gbk"></head><body><h1>x</h1><h1>y</h1><img src="/p.png"><p>�</p></body></html>`, type: "text/html; charset=UTF-8" },
  "/sitemap.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>` },
  "/sitemap-pages.xml": { type: "application/xml", body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}/orphan</loc></url></urlset>` },
};

const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  if (entry.throw !== undefined) throw new Error(entry.throw);
  void init;
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers: { "content-type": entry.type ?? "text/html; charset=utf-8" } });
}) as unknown as typeof fetch;

const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl, now: () => 1 };
const tools = builtinSeoTools();
type ToolCallResult = { content: Array<{ text: string }>; isError?: boolean };

async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const res = await handleSeoMcp(req, { tools, context: ctx, outputBudgetChars: 200_000 });
  const r = res!.result as ToolCallResult;
  return { text: r.content[0].text, isError: r.isError };
}

describe("kunpeng-seo 第二批工具接线(作者锁定)", () => {
  test("工具清单顺序与注解", () => {
    expect(tools.map((t) => t.name)).toEqual(["seo_audit_page", "seo_geo_citability", "seo_crawl_site", "seo_internal_links", "seo_gsc_sites", "seo_gsc_query", "seo_gsc_inspect", "seo_sitemap_gate", "seo_first_html_check", "seo_robots_check", "seo_ai_crawler_report", "seo_retraction_sweep", "seo_hreflang_cluster", "seo_discovery_check", "seo_structured_data", "seo_serp_budget", "seo_canonical_check", "seo_site_report", "seo_indexnow_submit"]);
    for (const name of ["seo_audit_page", "seo_crawl_site", "seo_internal_links"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    expect(tools.find((t) => t.name === "seo_audit_page")!.inputSchema.required).toEqual(["url"]);
    expect(tools.find((t) => t.name === "seo_crawl_site")!.inputSchema.required).toEqual(["startUrl"]);
    expect(tools.find((t) => t.name === "seo_internal_links")!.inputSchema.required).toEqual(["startUrl"]);
  });

  test("seo_audit_page:经 fetchImpl 抓页、带 HTTP 头编码进审计", async () => {
    const bad = JSON.parse((await callTool("seo_audit_page", { url: `${ORIGIN}/bad` })).text);
    expect(bad.url).toBe(`${ORIGIN}/bad`);
    expect(bad.charset).toBe("gbk");
    expect(bad.findings.map((f: { rule: string }) => f.rule)).toContain("charset-mismatch");
    expect(bad.findings.map((f: { rule: string }) => f.rule)).toContain("mojibake");
    expect(bad.h1Count).toBe(2);

    const good = JSON.parse((await callTool("seo_audit_page", { url: `${ORIGIN}/a` })).text);
    expect(good.findings).toEqual([]);
    expect(good.title.text).toBe("A guide page for DemoTravel");

    const missing = await callTool("seo_audit_page", { url: `${ORIGIN}/nope` });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe("错误：HTTP 404");
  });

  test("seo_crawl_site:页数、状态直方图、robots 拦截、精简页面列表", async () => {
    const r = JSON.parse((await callTool("seo_crawl_site", { startUrl: ORIGIN })).text);
    expect(r.startUrl).toBe(`${ORIGIN}/`);
    expect(r.pageCount).toBe(4);
    expect(r.statusCounts).toEqual({ "200": 3, "404": 1 });
    expect(r.blockedByRobots).toEqual([`${ORIGIN}/private/x`]);
    expect(r.pages[0]).toEqual({ url: `${ORIGIN}/`, status: 200, depth: 0, title: "Home guide page for DemoTravel" });
    expect(r.pages.every((p: Record<string, unknown>) => !("links" in p))).toBe(true);

    const capped = JSON.parse((await callTool("seo_crawl_site", { startUrl: ORIGIN, maxPages: 2 })).text);
    expect(capped.pageCount).toBe(2);
    const huge = JSON.parse((await callTool("seo_crawl_site", { startUrl: ORIGIN, maxPages: 99_999 })).text);
    expect(huge.pageCount).toBe(4);
  });

  test("seo_internal_links:sitemapindex 展开、孤儿、漏列、断链、榜单", async () => {
    const g = JSON.parse((await callTool("seo_internal_links", { startUrl: `${ORIGIN}/` })).text);
    expect(g.sitemapStatus).toBe("ok");
    expect(g.sitemapCount).toBe(3);
    expect(g.orphans).toEqual([`${ORIGIN}/orphan`]);
    expect(g.notInSitemap).toEqual([`${ORIGIN}/b`]);
    expect(g.broken).toEqual([{ from: `${ORIGIN}/`, to: `${ORIGIN}/gone`, status: 404 }]);
    expect(g.deep).toEqual([]);
    expect(g.blockedByRobots).toEqual([`${ORIGIN}/private/x`]);
    expect(g.zeroInbound).toEqual([]);
    expect(g.topInbound[0]).toMatchObject({ url: expect.stringMatching(/\/(a|b)$/), inbound: 2 });
    expect(g.topPageRank).toHaveLength(4);
    expect(g.topPageRank[0].pageRank).toBeGreaterThan(g.topPageRank[3].pageRank);

    const noMap = JSON.parse((await callTool("seo_internal_links", { startUrl: `${ORIGIN}/`, sitemapUrl: `${ORIGIN}/none.xml` })).text);
    expect(noMap.sitemapStatus).toBe("missing");
    expect(noMap.sitemapCount).toBe(0);
    expect(noMap.orphans).toEqual([]);
    expect(noMap.notInSitemap).toEqual([]);
  });
});