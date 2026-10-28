import { describe, expect, test } from "vitest";
import { handleSeoMcp, type JsonRpcRequest, type SeoToolContext } from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";

const ORIGIN = "https://demo-travel.ai";
const html = (title: string, head = "") => `<html><head><title>${title}</title>${head}</head><body><h1>${title}</h1></body></html>`;
const canon = (href: string) => `<link rel="canonical" href="${href}">`;

const SITE: Record<string, { status?: number; body?: string }> = {
  "/guide": { body: html("Beijing metro guide for foreign visitors", canon(`${ORIGIN}/guide`)) },
  "/guide-old": { body: html("Beijing metro guide 2024", canon(`${ORIGIN}/guide`)) },
  "/wrong": { body: html("Alipay setup for foreign cards", canon(`${ORIGIN}/terms`)) },
  "/terms": { body: html("Refund policy and terms", canon(`${ORIGIN}/terms`)) },
  "/dead": { body: html("Shanghai taxi fares", canon(`${ORIGIN}/gone`)) },
  "/gone": { status: 404 },
};

const seen: string[] = [];
const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  seen.push(`${new Headers(init?.headers).get("user-agent") ?? "-"} ${url.pathname}`);
  const entry = SITE[url.pathname];
  if (entry === undefined) return new Response("nf", { status: 404 });
  return new Response(entry.body ?? "", { status: entry.status ?? 200, headers: { "content-type": "text/html" } });
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

describe("门包第三批接线:canonical 目标核验(作者锁定)", () => {
  test("工具注解、位置与必填参数", () => {
    const tool = tools.find((t) => t.name === "seo_canonical_check")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tool.inputSchema.required).toEqual(["urls"]);
    expect(Object.keys(tool.inputSchema.properties as Record<string, unknown>).sort()).toEqual(["similarityMin", "urls"]);
    const names = tools.map((t) => t.name);
    expect(names.indexOf("seo_canonical_check")).toBe(names.indexOf("seo_serp_budget") + 1);
    expect(names.indexOf("seo_canonical_check")).toBe(names.indexOf("seo_site_report") - 1);
  });

  test("seo_canonical_check:错指与断链红、相似归一绿、抓不到的页记 warn、缺 urls 拒绝", async () => {
    seen.length = 0;
    const r = JSON.parse((await callTool("seo_canonical_check", { urls: [`${ORIGIN}/guide-old`, `${ORIGIN}/wrong`, `${ORIGIN}/dead`, `${ORIGIN}/missing`] })).text);
    expect(r.ok).toBe(false);
    expect(r.checked).toBe(3);
    expect(r.fetched).toBe(3);
    expect(r.failed).toEqual([{ url: `${ORIGIN}/missing`, status: 404 }]);
    expect(r.findings.map((f: { rule: string; severity: string; evidence?: string }) => [f.rule, f.severity, f.evidence])).toEqual([
      ["canonical-target-dissimilar", "warn", `${ORIGIN}/terms`],
      ["canonical-target-unreachable", "error", `${ORIGIN}/gone`],
      ["canonical-fetch-failed", "warn", `${ORIGIN}/missing`],
    ]);
    expect(r.pages[0].target.similarity).toBeGreaterThan(0.2);
    expect(seen.every((s) => s.startsWith("kunpeng-seo/0.1 "))).toBe(true);
    expect(seen.filter((s) => s.endsWith(" /guide"))).toHaveLength(1);

    const strict = JSON.parse((await callTool("seo_canonical_check", { urls: [`${ORIGIN}/guide-old`], similarityMin: 0.9 })).text);
    expect(strict.ok).toBe(true);
    expect(strict.findings.map((f: { rule: string }) => f.rule)).toEqual(["canonical-target-dissimilar"]);

    const missing = await callTool("seo_canonical_check", {});
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe("缺少参数：urls");
  });
});