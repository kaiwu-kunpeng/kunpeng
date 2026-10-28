import { eraResponse, preflightMcp, withListCache, withResultType } from "../mcp/protocol-era.js";
import { kunpengVersion } from "../runtime/version.js";
import type { SqlRunner } from "../server/crawler/store.js";
import type { GscClient } from "./gsc.js";
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface SeoToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

export interface SeoToolContext {
  repoRoot: string;
  fetchImpl: typeof fetch;
  now: () => number;
  sqlRunner?: SqlRunner;
  gscClient?: Pick<GscClient, "listSites" | "searchAnalytics" | "inspect">;
}

export interface SeoToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  annotations: SeoToolAnnotations;
  run: (args: Record<string, unknown>, ctx: SeoToolContext) => Promise<string>;
}

export const SEO_TOOL_NAME = /^(seo|gsc|geo)_[a-z0-9_]+$/;

export function defineSeoTool(def: SeoToolDef): SeoToolDef {
  if (!SEO_TOOL_NAME.test(def.name)) {
    throw new Error(`非法工具名：${def.name}（必须匹配 ${SEO_TOOL_NAME}）`);
  }
  return def;
}

export function buildSeoToolIndex(tools: SeoToolDef[]): Map<string, SeoToolDef> {
  const index = new Map<string, SeoToolDef>();
  for (const tool of tools) {
    const { name } = tool;
    if (index.has(name)) {
      throw new Error(`工具重名：${name}`);
    }
    index.set(name, defineSeoTool(tool));
  }
  return index;
}

export const DEFAULT_OUTPUT_BUDGET_CHARS = 12_000;

export function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const dropped = text.length - budget;
  return `${text.slice(0, budget)}\n…[已截断 ${dropped} 字符]`;
}

export interface SeoMcpDeps {
  tools: SeoToolDef[];
  context: SeoToolContext;
  allowDestructive?: boolean;
  outputBudgetChars?: number;
  recordCall?: (tool: string) => void;
}

export async function handleSeoMcp(
  req: JsonRpcRequest,
  deps: SeoMcpDeps,
): Promise<JsonRpcResponse | null> {
  const era = preflightMcp(req.method, req.params, { name: "kunpeng-seo", version: kunpengVersion() });
  if (era) return eraResponse(req.id ?? null, era) as JsonRpcResponse;

  if (req.method === "tools/list") {
    return ok(req, withListCache(req.params, {
      tools: deps.tools.map(({ name, description, inputSchema, annotations }) => ({
        name, description, inputSchema, annotations,
      })),
    }));
  }

  if (req.method === "tools/call") {
    return handleToolCall(req, deps);
  }

  if (req.id === undefined) return null;
  return err(req, -32601, `method not found: ${req.method}`);
}

async function handleToolCall(req: JsonRpcRequest, deps: SeoMcpDeps): Promise<JsonRpcResponse> {
  const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
  const name = params?.name;
  const args = params?.arguments ?? {};
  const index = buildSeoToolIndex(deps.tools);
  const tool = name === undefined ? undefined : index.get(name);
  if (!tool) return err(req, -32601, `unknown tool: ${name}`);

  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] === undefined) {
      return toolError(req, `缺少参数：${key}`);
    }
  }

  if (tool.annotations.destructiveHint === true && deps.allowDestructive !== true) {
    return toolError(req, `拒绝：${name} 是外发/破坏性工具，需要人工门（allowDestructive）`);
  }

  let text: string;
  try {
    text = await tool.run(args, deps.context);
  } catch (error) {
    return toolError(req, `错误：${error instanceof Error ? error.message : String(error)}`);
  }

  deps.recordCall?.(tool.name);
  return ok(req, withResultType(req.params, {
    content: [{ type: "text", text: truncateToBudget(text, deps.outputBudgetChars ?? DEFAULT_OUTPUT_BUDGET_CHARS) }],
  }));
}

function ok(req: JsonRpcRequest, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id ?? null, result };
}

function err(req: JsonRpcRequest, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id ?? null, error: { code, message } };
}

function toolError(req: JsonRpcRequest, text: string): JsonRpcResponse {
  return ok(req, withResultType(req.params, { content: [{ type: "text", text }], isError: true }));
}
