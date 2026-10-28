import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ORIGIN = "https://demo-travel.ai";
const CLAIM = "129 official ticket sites";
const FIXED_NOW = Date.UTC(2026, 8, 8, 7, 15, 0);
const BODY = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how a foreign card links to Alipay at the airport.`).join(" ");
const page = (title: string, links: string[] = [], extra = "", body = BODY) =>
  `<html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${"d".repeat(120)}"><meta property="og:image" content="/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">${extra}</head><body><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; link?: string }> = {
  "/robots.txt": { body: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n` },
  "/llms.txt": { body: `# DemoTravel\n- [Tickets](/tickets)\n- [Gone](/gone)\n` },
  "/": { body: page("DemoTravel home for foreign visitors", ["/tickets", "/clean", "/long", "/shell", "/bad", "/gone"], `<script type="application/ld+json">{"@type":"Organization","url":"${ORIGIN}/","logo":"/icon.png"}</script>`), link: `</route-index.json>; rel="alternate"` },
  "/tickets": { body: page("Ticket sites for foreign visitors", ["/"], `<meta property="og:description" content="Built from ${CLAIM}.">`) },
  "/clean": { body: page("Passport checks at ticket counters", ["/"]) },
  "/long": { body: page("Metro &amp; taxi fares in Shanghai for foreign visitors in 2026 explained", ["/"]) },
  "/shell": { body: `<html><head><title>App</title></head><body><noscript>Please enable JavaScript</noscript><div id="__next"></div><script src="/app.js"></script></body></html>` },
  "/bad": { body: `<html><head><meta charset="gbk"></head><body><h1>x</h1><h1>y</h1><img src="/p.png"><p>${BODY} �</p><a href="/">home</a></body></html>`, type: "text/html; charset=UTF-8" },
  "/orphan": { body: page("Orphan page nobody links to") },
  "/sitemap.xml": { type: "application/xml", body: `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>` },
  "/sitemap-pages.xml": { type: "application/xml", body: `<urlset>${["/", "/tickets", "/clean", "/long", "/shell", "/bad", "/orphan"].map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("")}</urlset>` },
  "/route-index.json": { type: "application/json", body: "{}" },
  "/icon.png": { status: 404 },
  "/gone": { status: 404 },
};

const fetchImpl = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname !== "demo-travel.ai") return new Response("", { status: 404 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  const headers: Record<string, string> = { "content-type": entry.type ?? "text/html; charset=utf-8" };
  if (entry.link !== undefined) headers.link = entry.link;
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers });
}) as unknown as typeof fetch;

describe("seo_site_report 工具与 CLI 接线(作者锁定)", () => {
  test("seo_site_report 工具:排在 seo_indexnow_submit 之前,落盘并回摘要", async () => {
    const tools = builtinSeoTools();
    expect(tools.map((t) => t.name).slice(-2)).toEqual(["seo_site_report", "seo_indexnow_submit"]);
    const tool = tools.find((t) => t.name === "seo_site_report")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tool.inputSchema.required).toEqual(["origin"]);
    expect(Object.keys(tool.inputSchema.properties as Record<string, unknown>).sort()).toEqual(["allow", "maxPages", "origin", "outDir", "sitemapUrl", "terms"]);
    const outDir = mkdtempSync(join(tmpdir(), "seo-report-tool-"));
    const ctx: SeoToolContext = { repoRoot: "/tmp/demo-repo", fetchImpl, now: () => FIXED_NOW };
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_site_report", arguments: { origin: ORIGIN, outDir, terms: [CLAIM] } } };
    const res = await handleSeoMcp(req, { tools, context: ctx });
    const r = res!.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();
    const summary = JSON.parse(r.content[0].text);
    expect(summary.origin).toBe(ORIGIN);
    expect(summary.totals.ok).toBe(false);
    expect((summary.layers as Array<{ id: string }>).map((l) => l.id)).toContain("retraction");
    expect(summary.files.markdownPath).toBe(join(outDir, "demo-travel-ai-20260908-071500.md"));
    expect(existsSync(summary.files.markdownPath)).toBe(true);
    expect(existsSync(summary.files.jsonPath)).toBe(true);
  });
});