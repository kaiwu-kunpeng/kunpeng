import { describe, expect, test } from "vitest";
import { SEO_GATE_IDS } from "../../src/seo/gates/index.js";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ORIGIN = "https://demo-travel.ai";
const BODY = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how a foreign card links to Alipay at the airport.`).join(" ");
const html = (title: string, links: string[]) =>
  `<html lang="en"><head><meta charset="utf-8"><title>${title} guide page for DemoTravel</title></head><body><h1>${title}</h1><p class="byline">By <span class="author">Editorial Desk</span></p><p>${BODY}</p>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; throw?: string }> = {
  "/robots.txt": { body: "User-agent: *\nAllow: /\nDisallow: /private\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nSitemap: https://demo-travel.ai/sitemap.xml\n" },
  "/": { body: html("Home", ["/a", "/b", "/private/x"]) },
  "/a": { body: html("A", ["/b"]) },
  "/b": { body: html("B", ["/a"]) },
  "/orphan": { body: html("Orphan", []) },
  "/auth/login": { body: html("Login", []) },
  "/shell": { body: `<html><head><title>App</title></head><body><noscript>Please enable JavaScript</noscript><div id="__next"></div><script src="/app.js"></script></body></html>` },
  "/sitemap.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>` },
  "/sitemap-pages.xml": { type: "application/xml", body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}/orphan</loc></url><url><loc>${ORIGIN}/auth/login</loc></url></urlset>` },
};

const seen: string[] = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  seen.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.pathname}`);
  if (url.hostname !== "demo-travel.ai") return new Response("", { status: 404 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  if (entry.throw !== undefined) throw new Error(entry.throw);
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

describe("门包接线:三个门变成只读 MCP 工具(作者锁定)", () => {
  test("门注册表与工具清单", () => {
    expect([...SEO_GATE_IDS]).toEqual(["sitemap-orphan", "first-html", "robots-classes", "retraction-sweep", "discovery-liveness", "serp-budget", "canonical-target"]);
    expect(tools.map((t) => t.name)).toEqual([
      "seo_audit_page", "seo_geo_citability", "seo_crawl_site", "seo_internal_links",
      "seo_gsc_sites", "seo_gsc_query", "seo_gsc_inspect",
      "seo_sitemap_gate", "seo_first_html_check", "seo_robots_check", "seo_ai_crawler_report",
      "seo_retraction_sweep", "seo_hreflang_cluster", "seo_discovery_check", "seo_structured_data", "seo_serp_budget", "seo_canonical_check", "seo_site_report", "seo_indexnow_submit",
    ]);
    for (const name of ["seo_sitemap_gate", "seo_first_html_check", "seo_robots_check"]) {
      expect(tools.find((t) => t.name === name)!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    expect(tools.find((t) => t.name === "seo_sitemap_gate")!.inputSchema.required).toEqual(["startUrl"]);
    expect(tools.find((t) => t.name === "seo_first_html_check")!.inputSchema.required).toEqual(["url", "expectations"]);
    expect(tools.find((t) => t.name === "seo_robots_check")!.inputSchema.required).toEqual(["origin"]);
  });

  test("seo_sitemap_gate:爬取 + sitemapindex 展开 + 孤儿裁决;allow 豁免", async () => {
    const red = JSON.parse((await callTool("seo_sitemap_gate", { startUrl: ORIGIN })).text);
    expect(red.ok).toBe(false);
    expect(red.sitemapStatus).toBe("ok");
    expect(red.sitemapCount).toBe(4);
    expect(red.pageCount).toBe(3);
    expect(red.orphans).toEqual([`${ORIGIN}/auth/login`, `${ORIGIN}/orphan`]);
    expect(red.findings.filter((f: { rule: string }) => f.rule === "sitemap-orphan")).toHaveLength(2);
    expect(red.linkedCount).toBe(2);

    const green = JSON.parse((await callTool("seo_sitemap_gate", { startUrl: ORIGIN, allow: ["/auth/", "/orphan"] })).text);
    expect(green.ok).toBe(true);
    expect(green.orphans).toEqual([]);
    expect(green.ignored).toEqual([`${ORIGIN}/auth/login`, `${ORIGIN}/orphan`]);

    const noMap = JSON.parse((await callTool("seo_sitemap_gate", { startUrl: ORIGIN, sitemapUrl: `${ORIGIN}/none.xml` })).text);
    expect(noMap.ok).toBe(false);
    expect(noMap.sitemapStatus).toBe("missing");
    expect(noMap.findings[0].rule).toBe("sitemap-empty");
  });

  test("seo_first_html_check:SSR 页通过,JS 空壳红,缺 expectations 参数拒绝", async () => {
    const ok = JSON.parse((await callTool("seo_first_html_check", { url: `${ORIGIN}/a`, expectations: [{ id: "author", text: "editorial desk", selector: ".byline" }, { id: "h1", regex: "^A" , selector: "h1" }] })).text);
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe(200);
    expect(ok.present).toEqual(["author", "h1"]);
    const shell = JSON.parse((await callTool("seo_first_html_check", { url: `${ORIGIN}/shell`, expectations: [{ id: "author", text: "editorial desk" }] })).text);
    expect(shell.ok).toBe(false);
    expect(shell.shell).toBe(true);
    expect(shell.missing).toEqual(["author"]);
    expect(shell.findings.map((f: { rule: string }) => f.rule)).toEqual(["first-html-shell", "first-html-noscript", "first-html-empty-root", "first-html-missing"]);
    const missing = await callTool("seo_first_html_check", { url: `${ORIGIN}/a` });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe("缺少参数：expectations");
    expect(seen.some((s) => s.startsWith("kunpeng-seo/0.1 /a"))).toBe(true);
  });

  test("seo_robots_check:origin 归一化、三类裁决、策略透传", async () => {
    const r = JSON.parse((await callTool("seo_robots_check", { origin: `${ORIGIN}/some/page?x=1` })).text);
    expect(r.status).toBe(200);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f: { rule: string; evidence?: string }) => [f.rule, f.evidence])).toEqual([["robots-search-blocked", "OAI-SearchBot"]]);
    expect(r.reports.find((x: { agent: string }) => x.agent === "Googlebot").verdict).toBe("partial");
    expect(r.sitemaps).toEqual([`${ORIGIN}/sitemap.xml`]);
    expect(seen.at(-1)).toBe("kunpeng-seo/0.1 /robots.txt");

    const lax = JSON.parse((await callTool("seo_robots_check", { origin: ORIGIN, policy: { search: "any", training: "block" }, requireSitemap: false })).text);
    expect(lax.ok).toBe(true);
    expect(lax.findings.every((f: { rule: string }) => f.rule === "robots-training-policy")).toBe(true);
    expect(lax.findings).toHaveLength(9);

    const none = JSON.parse((await callTool("seo_robots_check", { origin: "https://none.demo-travel.ai" })).text);
    expect(none.status).toBe(404);
    expect(none.findings[0].rule).toBe("robots-missing");
  });
});