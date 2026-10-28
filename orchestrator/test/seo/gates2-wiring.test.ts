import { describe, expect, test } from "vitest";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ORIGIN = "https://demo-travel.ai";
const CLAIM = "129 official ticket sites";
const BODY = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains how a foreign card links to Alipay at the airport.`).join(" ");
const page = (title: string, extra = "", body = BODY) =>
  `<html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${"d".repeat(120)}"><meta property="og:image" content="/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">${extra}</head><body><h1>${title}</h1><p>${body}</p></body></html>`;

const SITE: Record<string, { status?: number; type?: string; body?: string; throw?: string; link?: string }> = {
  "/robots.txt": { body: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n` },
  "/llms.txt": { body: `# DemoTravel\n- [Tickets](/tickets)\n- [Gone](/gone)\n` },
  "/": { body: page("DemoTravel home for foreign visitors", `<script type="application/ld+json">{"@type":"Organization","url":"${ORIGIN}/","logo":"/icon.png"}</script>`), link: `</route-index.json>; rel="alternate"` },
  "/tickets": { body: page("Ticket sites for foreign visitors", `<meta property="og:description" content="Built from ${CLAIM}.">`) },
  "/clean": { body: page("Passport checks at ticket counters") },
  "/long": { body: page("Metro &amp; taxi fares in Shanghai for foreign visitors in 2026 explained") },
  "/sitemap.xml": { type: "application/xml", body: "<urlset/>" },
  "/route-index.json": { type: "application/json", body: "{}" },
  "/icon.png": { status: 404 },
  "/gone": { status: 404 },
};

const fetchImpl = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname !== "demo-travel.ai") return new Response("", { status: 404 });
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  if (entry.throw !== undefined) throw new Error(entry.throw);
  const headers: Record<string, string> = { "content-type": entry.type ?? "text/html; charset=utf-8" };
  if (entry.link !== undefined) headers.link = entry.link;
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers });
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

describe("门包第二批接线:撤稿七面 / 发现层存活 / SERP 行预算(作者锁定)", () => {
  test("工具注解与必填参数", () => {
    for (const name of ["seo_retraction_sweep", "seo_discovery_check", "seo_serp_budget"]) {
      expect(tools.find((t) => t.name === name)!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
    expect(tools.find((t) => t.name === "seo_retraction_sweep")!.inputSchema.required).toEqual(["urls", "terms"]);
    expect(tools.find((t) => t.name === "seo_discovery_check")!.inputSchema.required).toEqual(["origin"]);
    expect(tools.find((t) => t.name === "seo_serp_budget")!.inputSchema.required).toEqual(["urls"]);
  });

  test("seo_retraction_sweep:命中 og:description 红;抓不到的页算未验证;全净绿", async () => {
    const red = JSON.parse((await callTool("seo_retraction_sweep", { urls: [`${ORIGIN}/tickets`, `${ORIGIN}/gone`], terms: [CLAIM], discoveryUrls: [`${ORIGIN}/llms.txt`] })).text);
    expect(red.ok).toBe(false);
    expect(red.checked).toEqual({ pages: 1, discovery: 1, terms: 1 });
    expect(red.hits.map((h: { facet: string }) => h.facet)).toEqual(["social-meta"]);
    expect(red.failed).toEqual([{ url: `${ORIGIN}/gone`, status: 404 }]);
    expect(red.findings.map((f: { rule: string }) => f.rule)).toEqual(["retraction-hit", "retraction-unverified"]);
    const green = JSON.parse((await callTool("seo_retraction_sweep", { urls: [`${ORIGIN}/clean`], terms: [CLAIM] })).text);
    expect(green.ok).toBe(true);
    expect(green.findings).toEqual([]);
    const bad = await callTool("seo_retraction_sweep", { urls: [`${ORIGIN}/clean`] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toBe("缺少参数：terms");
  });

  test("seo_discovery_check:logo 404 与 llms 里的 /gone 红;外链默认跳过", async () => {
    const r = JSON.parse((await callTool("seo_discovery_check", { origin: `${ORIGIN}/x?y=1` })).text);
    expect(r.ok).toBe(false);
    expect(r.sources).toEqual({ "llms.txt": 2, "robots.txt": 1, "link-header": 1, "json-ld": 1 });
    expect(r.probes.filter((p: { ok: boolean }) => !p.ok).map((p: { url: string }) => p.url)).toEqual([`${ORIGIN}/gone`, `${ORIGIN}/icon.png`]);
    expect(r.findings.map((f: { rule: string }) => f.rule)).toEqual(["discovery-dead-url", "discovery-dead-url"]);
  });

  test("seo_serp_budget:逐 URL 抓产物量标题;实体算原文;抓不到的页 warn", async () => {
    const r = JSON.parse((await callTool("seo_serp_budget", { urls: [`${ORIGIN}/clean`, `${ORIGIN}/long`, `${ORIGIN}/gone`], titleMax: 60 })).text);
    expect(r.ok).toBe(false);
    expect(r.pages.map((p: { url: string; titleLength: number }) => [p.url, p.titleLength])).toEqual([[`${ORIGIN}/clean`, 34], [`${ORIGIN}/long`, 73]]);
    expect(r.failed).toEqual([{ url: `${ORIGIN}/gone`, status: 404 }]);
    expect(r.findings.map((f: { rule: string; severity: string }) => [f.rule, f.severity])).toEqual([
      ["serp-title-over-budget", "error"],
      ["serp-description-duplicate", "warn"],
      ["serp-fetch-failed", "warn"],
    ]);
    expect(r.findings[2].evidence).toBe(`${ORIGIN}/gone`);
    const wide = JSON.parse((await callTool("seo_serp_budget", { urls: [`${ORIGIN}/clean`, `${ORIGIN}/long`], titleMax: 80 })).text);
    expect(wide.ok).toBe(true);
    expect(wide.findings.map((f: { rule: string }) => f.rule)).toEqual(["serp-description-duplicate"]);
  });
});