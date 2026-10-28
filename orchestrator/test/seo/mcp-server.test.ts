import { describe, expect, test, vi } from "vitest";
import { Readable } from "node:stream";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_OUTPUT_BUDGET_CHARS,
  SEO_TOOL_NAME,
  buildSeoToolIndex,
  defineSeoTool,
  handleSeoMcp,
  truncateToBudget,
  type JsonRpcRequest,
  type SeoMcpDeps,
  type SeoToolContext,
  type SeoToolDef,
} from "../../src/seo/mcp-server.js";
import { builtinSeoTools } from "../../src/seo/tools.js";
import { buildSeoServeDeps, runSeoMcpStdio } from "../../src/seo/serve-cmd.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { usageText } from "../../src/cli.js";
import { kunpengVersion } from "../../src/runtime/version.js";

type ToolListResult = { tools: Array<{ name: string; annotations: Record<string, boolean>; run?: unknown }> };
type ToolCallResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const ctx: SeoToolContext = {
  repoRoot: "/tmp/demo-repo",
  fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
  now: () => 1_700_000_000_000,
};

const echoTool: SeoToolDef = defineSeoTool({
  name: "seo_echo",
  description: "回显参数（只读）",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  run: async (args) => `echo:${String(args.text)}`,
});

const boomTool: SeoToolDef = defineSeoTool({
  name: "seo_boom",
  description: "总是抛错",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  run: async () => {
    throw new Error("upstream 503");
  },
});

const pushTool: SeoToolDef = defineSeoTool({
  name: "seo_push_demo",
  description: "外发动作（破坏性）",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  run: async () => "pushed",
});

function deps(overrides: Partial<SeoMcpDeps> = {}): SeoMcpDeps {
  return { tools: [echoTool, boomTool, pushTool], context: ctx, ...overrides };
}

const call = (name: string, args: Record<string, unknown> = {}, id: number = 1): JsonRpcRequest => ({
  jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args },
});

describe("kunpeng-seo MCP 骨架(作者锁定)", () => {
  test("initialize 返回 kunpeng-seo 身份与 tools 能力", async () => {
    const res = await handleSeoMcp({ jsonrpc: "2.0", id: 1, method: "initialize" }, deps());
    expect(res).toMatchObject({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2024-11-05", serverInfo: { name: "kunpeng-seo", version: kunpengVersion() }, capabilities: { tools: {} } },
    });
  });

  test("tools/list 带 annotations、不泄漏 run", async () => {
    const res = await handleSeoMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps());
    const tools = (res!.result as ToolListResult).tools;
    expect(tools.map((t) => t.name)).toEqual(["seo_echo", "seo_boom", "seo_push_demo"]);
    expect(tools[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tools[2].annotations.destructiveHint).toBe(true);
    for (const t of tools) expect(t).not.toHaveProperty("run");
  });

  test("tools/call 成功:content.text 是 run 的返回值,recordCall 记一次", async () => {
    const recordCall = vi.fn();
    const res = await handleSeoMcp(call("seo_echo", { text: "hi" }), deps({ recordCall }));
    expect(res!.result).toEqual({ content: [{ type: "text", text: "echo:hi" }] });
    expect(recordCall).toHaveBeenCalledWith("seo_echo");
    expect(recordCall).toHaveBeenCalledTimes(1);
  });

  test("缺必填参数 → isError 且不执行", async () => {
    const recordCall = vi.fn();
    const res = await handleSeoMcp(call("seo_echo", {}), deps({ recordCall }));
    const r = res!.result as ToolCallResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("缺少参数：text");
    expect(recordCall).not.toHaveBeenCalled();
  });

  test("破坏性工具默认拒绝(人工门);allowDestructive 才放行", async () => {
    const recordCall = vi.fn();
    const denied = await handleSeoMcp(call("seo_push_demo"), deps({ recordCall }));
    const r = denied!.result as ToolCallResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text.startsWith("拒绝：seo_push_demo")).toBe(true);
    expect(r.content[0].text).toContain("人工门");
    expect(recordCall).not.toHaveBeenCalled();

    const allowed = await handleSeoMcp(call("seo_push_demo"), deps({ recordCall, allowDestructive: true }));
    expect(allowed!.result).toEqual({ content: [{ type: "text", text: "pushed" }] });
    expect(recordCall).toHaveBeenCalledWith("seo_push_demo");
  });

  test("工具抛错 → isError 文本以「错误：」开头,服务不崩", async () => {
    const res = await handleSeoMcp(call("seo_boom"), deps());
    const r = res!.result as ToolCallResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("错误：upstream 503");
    expect(res!.error).toBeUndefined();
  });

  test("未知工具 → -32601;未知方法带 id → -32601;通知(无 id)→ null", async () => {
    const unknownTool = await handleSeoMcp(call("seo_nope"), deps());
    expect(unknownTool!.error).toEqual({ code: -32601, message: "unknown tool: seo_nope" });
    const unknownMethod = await handleSeoMcp({ jsonrpc: "2.0", id: 9, method: "prompts/list" }, deps());
    expect(unknownMethod!.error?.code).toBe(-32601);
    expect(unknownMethod!.id).toBe(9);
    const notification = await handleSeoMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, deps());
    expect(notification).toBeNull();
  });

  test("输出预算:超长文本截断并标注字符数", async () => {
    expect(truncateToBudget("abc", 3)).toBe("abc");
    expect(truncateToBudget("abcdef", 4)).toBe("abcd\n…[已截断 2 字符]");
    expect(DEFAULT_OUTPUT_BUDGET_CHARS).toBe(12_000);
    const long: SeoToolDef = defineSeoTool({
      ...echoTool, name: "seo_long", run: async () => "x".repeat(50),
    });
    const res = await handleSeoMcp(call("seo_long", { text: "t" }), deps({ tools: [long], outputBudgetChars: 10 }));
    expect((res!.result as ToolCallResult).content[0].text).toBe(`${"x".repeat(10)}\n…[已截断 40 字符]`);
  });

  test("工具名必须带 seo_/gsc_/geo_ 前缀;重名报错", () => {
    expect(SEO_TOOL_NAME.test("seo_crawl_site")).toBe(true);
    expect(SEO_TOOL_NAME.test("gsc_query_gaps")).toBe(true);
    expect(SEO_TOOL_NAME.test("geo_sample")).toBe(true);
    expect(() => defineSeoTool({ ...echoTool, name: "crawl_site" })).toThrow(/非法工具名/);
    expect(() => defineSeoTool({ ...echoTool, name: "seo_Bad-Name" })).toThrow(/非法工具名/);
    expect(() => buildSeoToolIndex([echoTool, { ...boomTool, name: "seo_echo" }])).toThrow(/工具重名：seo_echo/);
    expect(buildSeoToolIndex([echoTool, boomTool]).get("seo_boom")).toBe(boomTool);
  });

  test("内置 seo_indexnow_submit:破坏性注解,放行后只入 outbox 不外发", async () => {
    const tools = builtinSeoTools();
    const indexnow = tools.find((t) => t.name === "seo_indexnow_submit");
    expect(indexnow).toBeDefined();
    expect(indexnow!.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(indexnow!.inputSchema.required).toEqual(["host", "urls"]);
    for (const t of tools) expect(SEO_TOOL_NAME.test(t.name)).toBe(true);

    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("", { status: 202 }));
    const context: SeoToolContext = { ...ctx, fetchImpl: fetchImpl as unknown as typeof fetch, repoRoot: mkdtempSync(join(tmpdir(), "kp-indexnow-")) };
    const args = { host: "demo-travel.ai", key: "k", urls: ["https://demo-travel.ai/a", "https://demo-travel.ai/a", "https://demo-travel.ai/b"] };

    const denied = await handleSeoMcp(call("seo_indexnow_submit", args), { tools, context });
    expect((denied!.result as ToolCallResult).isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    const allowed = await handleSeoMcp(call("seo_indexnow_submit", args), { tools, context, allowDestructive: true });
    const text = (allowed!.result as ToolCallResult).content[0].text;
    expect(JSON.parse(text)).toMatchObject({ queued: true, channel: "indexnow", urls: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const raw = readFileSync(join(context.repoRoot, ".kunpeng", "outbox", "indexnow.json"), "utf8");
    expect(JSON.parse(raw)[0].payload).toEqual({ urls: ["https://demo-travel.ai/a", "https://demo-travel.ai/b"], host: "demo-travel.ai" });
    expect(raw).not.toContain('"key"');
  });

  test("stdio 循环:逐行 JSON-RPC,坏 JSON 回 -32700,通知不回包", async () => {
    const lines = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      "",
      "{not json",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "seo_echo", arguments: { text: "io" } } }),
    ];
    const chunks: string[] = [];
    const output = { write: (chunk: string | Uint8Array) => { chunks.push(String(chunk)); return true; } } as unknown as NodeJS.WritableStream;
    await runSeoMcpStdio(deps(), Readable.from([`${lines.join("\n")}\n`]), output);
    const out = chunks.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 1, result: { serverInfo: { name: "kunpeng-seo" } } });
    expect(out[1]).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    expect(out[2]).toMatchObject({ id: 2, result: { content: [{ type: "text", text: "echo:io" }] } });
  });

  test("serve 依赖:默认不放行破坏性工具,KUNPENG_SEO_ALLOW_DESTRUCTIVE=1 才放行", () => {
    const off = buildSeoServeDeps("/tmp/demo-repo", {});
    expect(off.allowDestructive).toBe(false);
    expect(off.context.repoRoot).toBe("/tmp/demo-repo");
    expect(off.tools.map((t) => t.name)).toContain("seo_indexnow_submit");
    expect(buildSeoServeDeps("/tmp/demo-repo", { KUNPENG_SEO_ALLOW_DESTRUCTIVE: "1" }).allowDestructive).toBe(true);
  });

  test("CLI:seo-mcp 已注册且进用法表", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("seo-mcp");
    expect(usageText()).toContain("seo-mcp");
  });
});