import { CodeGraph } from "./graph.js";
import { eraResponse, preflightMcp, withListCache, withResultType } from "../mcp/protocol-era.js";
import { kunpengVersion } from "../runtime/version.js";
import { impactedNodes } from "./impact.js";
import { skeleton } from "./skeleton.js";
import type { CodeGraphStore } from "./store.js";

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

interface CodegraphTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

interface ToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

export const CODEGRAPH_TOOLS: CodegraphTool[] = [
  {
    name: "codegraph_search",
    description: "Search code graph nodes by name substring.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "codegraph_callers",
    description: "List functions or symbols that call the named node.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        project: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "codegraph_callees",
    description: "List functions or symbols called by the named node.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        project: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "codegraph_context",
    description: "Render compact code graph context for matching nodes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxNodes: { type: "number" },
        project: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "codegraph_impact",
    description: "List upstream symbols impacted if the named node changes (reverse-caller BFS).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        depth: { type: "number" },
        project: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "codegraph_skeleton",
    description: "Render the full symbol outline of the code graph (kind name @ file:line).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

export interface CodegraphMcpDeps {
  store: CodeGraphStore;
  stores?: Map<string, CodeGraphStore>;
  recordCall?: (tool: string) => void;
}

export function handleCodegraphMcp(
  req: JsonRpcRequest,
  deps: CodegraphMcpDeps,
): JsonRpcResponse | null {
  const era = preflightMcp(req.method, req.params, { name: "kunpeng-codegraph", version: kunpengVersion() });
  if (era) return eraResponse(req.id ?? null, era) as JsonRpcResponse;

  if (req.method === "tools/list") {
    return ok(req, withListCache(req.params, { tools: CODEGRAPH_TOOLS }));
  }

  if (req.method === "tools/call") {
    return handleToolCall(req, deps);
  }

  if (req.id === undefined) {
    return null;
  }

  return err(req, -32601, `method not found: ${req.method}`);
}

function handleToolCall(
  req: JsonRpcRequest,
  deps: CodegraphMcpDeps,
): JsonRpcResponse {
  const params = req.params as ToolCallParams | undefined;
  const args = params?.arguments ?? {};
  const store = selectStore(deps, args);
  const toolName = params?.name;
  let text: string;

  switch (toolName) {
    case "codegraph_search":
      text = renderLines(store.search(readString(args, "query")).map((node) => node.name));
      break;
    case "codegraph_callers":
      text = renderNames(store.callers(readString(args, "name")).map((node) => node.name));
      break;
    case "codegraph_callees":
      text = renderNames(store.callees(readString(args, "name")).map((node) => node.name));
      break;
    case "codegraph_context": {
      const maxNodes = readNumber(args, "maxNodes");
      text = new CodeGraph(store).buildContext(
        readString(args, "query"),
        maxNodes ?? 10,
      );
      break;
    }
    case "codegraph_impact":
      text = renderNames(
        impactedNodes(
          store,
          readString(args, "name"),
          readNumber(args, "depth") ?? 2,
        ).map((node) => node.name),
      );
      break;
    case "codegraph_skeleton":
      text = skeleton(store);
      break;
    default:
      return err(req, -32601, `unknown tool: ${toolName}`);
  }

  deps.recordCall?.(toolName);
  return ok(req, withResultType(req.params, { content: [{ type: "text", text }] }));
}

function selectStore(deps: CodegraphMcpDeps, args: Record<string, unknown>): CodeGraphStore {
  const project = args.project;
  if (typeof project !== "string" || project.trim() === "") {
    return deps.store;
  }

  return deps.stores?.get(project) ?? deps.store;
}

function ok(req: JsonRpcRequest, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id ?? null, result };
}

function err(req: JsonRpcRequest, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id ?? null, error: { code, message } };
}

function renderLines(names: string[]): string {
  return names.length === 0 ? "(none)" : names.join("\n");
}

function renderNames(names: string[]): string {
  return names.length === 0 ? "(none)" : names.join(", ");
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}
