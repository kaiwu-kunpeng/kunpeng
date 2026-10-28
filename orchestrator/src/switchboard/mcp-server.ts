import { eraResponse, preflightMcp, withListCache, withResultType } from "../mcp/protocol-era.js";
import { kunpengVersion } from "../runtime/version.js";
import { isRecord } from "../util/is-record.js";
import { createInterface } from "node:readline";

import { cardsFromHeartbeats } from "./agent-card.js";
import { PresenceStore } from "./presence.js";
import { TaskStore } from "./task-store.js";

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

export interface McpDeps {
  taskStore: TaskStore;
  presence?: PresenceStore;
  now?: () => number;
}

export const TOOL_DEFS = [
  {
    name: "task_create",
    description: "建任务",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        body: { type: "string" },
      },
      required: ["from", "body"],
    },
  },
  {
    name: "task_send",
    description: "向任务追加消息",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        body: { type: "string" },
      },
      required: ["taskId", "from", "to", "body"],
    },
  },
  {
    name: "task_get",
    description: "查任务（含 status/history）",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_list",
    description: "列所有任务",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "task_cancel",
    description: "取消任务",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        reason: { type: "string" },
      },
      required: ["taskId", "from", "to"],
    },
  },
  {
    name: "task_complete",
    description: "把 A2A 任务标记完成(回执)",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        result: { type: "string" },
      },
      required: ["taskId", "from", "to"],
    },
  },
  {
    name: "task_fail",
    description: "把 A2A 任务标记失败",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        reason: { type: "string" },
      },
      required: ["taskId", "from", "to"],
    },
  },
  {
    name: "agent_list",
    description: "列在线/已知 agent（presence）",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agent_card",
    description: "列 agent 能力卡（含 online 与 skills）",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
] as const;

function objectParams(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readToolName(params: Record<string, unknown>): string {
  const name = params.name;
  if (typeof name === "string") return name;
  throw new Error(`unknown tool: ${String(name)}`);
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`${key} must be string`);
  return value;
}

function readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be string`);
  return value;
}

async function callTool(name: string, args: Record<string, unknown>, deps: McpDeps): Promise<string> {
  switch (name) {
    case "task_create":
      return JSON.stringify(
        await deps.taskStore.createTask({
          from: readString(args, "from"),
          to: readOptionalString(args, "to"),
          body: readString(args, "body"),
        }),
      );
    case "task_send":
      await deps.taskStore.sendToTask(readString(args, "taskId"), {
        from: readString(args, "from"),
        to: readString(args, "to"),
        body: readString(args, "body"),
      });
      return JSON.stringify({ ok: true });
    case "task_get":
      return JSON.stringify(await deps.taskStore.getTask(readString(args, "taskId")));
    case "task_list":
      return JSON.stringify(await deps.taskStore.listTasks());
    case "task_cancel":
      await deps.taskStore.cancelTask(readString(args, "taskId"), {
        from: readString(args, "from"),
        to: readString(args, "to"),
        reason: readOptionalString(args, "reason"),
      });
      return JSON.stringify({ ok: true });
    case "task_complete":
      await deps.taskStore.completeTask(readString(args, "taskId"), {
        from: readString(args, "from"),
        to: readString(args, "to"),
        result: readOptionalString(args, "result"),
      });
      return JSON.stringify({ ok: true });
    case "task_fail":
      await deps.taskStore.failTask(readString(args, "taskId"), {
        from: readString(args, "from"),
        to: readString(args, "to"),
        reason: readOptionalString(args, "reason"),
      });
      return JSON.stringify({ ok: true });
    case "agent_list":
      return JSON.stringify(deps.presence ? await deps.presence.list() : []);
    case "agent_card": {
      const now = (deps.now ?? Date.now)();
      const heartbeats = deps.presence ? await deps.presence.list() : [];
      return JSON.stringify(cardsFromHeartbeats(heartbeats, { now }));
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function handleMcpRequest(req: JsonRpcRequest, deps: McpDeps): Promise<JsonRpcResponse | null> {
  if (req.method.startsWith("notifications/") || req.id === undefined) return null;

  const id = req.id ?? null;

  const era = preflightMcp(req.method, req.params, { name: "kunpeng-switchboard", version: kunpengVersion() });
  if (era) return eraResponse(id, era) as JsonRpcResponse;

  if (req.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: withListCache(req.params, { tools: TOOL_DEFS }) };
  }

  if (req.method === "tools/call") {
    try {
      const params = objectParams(req.params);
      const text = await callTool(readToolName(params), objectParams(params.arguments), deps);
      return { jsonrpc: "2.0", id, result: withResultType(req.params, { content: [{ type: "text", text }] }) };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: withResultType(req.params, {
          content: [{ type: "text", text: String(e instanceof Error ? e.message : e) }],
          isError: true,
        }),
      };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
}

export async function runMcpStdio(
  deps: McpDeps,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;

    let res: JsonRpcResponse | null;
    try {
      res = await handleMcpRequest(JSON.parse(s), deps);
    } catch {
      res = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }

    if (res !== null) output.write(`${JSON.stringify(res)}\n`);
  }
}
