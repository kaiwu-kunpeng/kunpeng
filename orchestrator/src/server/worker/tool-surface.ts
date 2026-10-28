import { safeRelativePath } from "../localfs/mcp-server.js";

export const WORKER_TOOLS = [
  "ws_read",
  "ws_write",
  "ws_list",
  "ws_stat",
  "ws_delete",
  "ws_mkdir",
  "ws_exec",
] as const;

export type WorkerToolName = (typeof WORKER_TOOLS)[number];

export interface WorkerFsOp {
  op: "fs";
  kind: "read" | "write" | "list" | "stat" | "delete" | "mkdir";
  path: string;
  content?: string;
  recursive?: boolean;
  encoding?: "text" | "base64";
}

export interface WorkerExecOp {
  op: "exec";
  command: string;
  timeoutMs?: number;
}

const FS_TOOL_KINDS = {
  ws_read: "read",
  ws_write: "write",
  ws_list: "list",
  ws_stat: "stat",
  ws_delete: "delete",
  ws_mkdir: "mkdir",
} as const;

export function toolToWorkerOp(name: string, args: unknown): WorkerFsOp | WorkerExecOp {
  if (!isWorkerToolName(name)) throw new Error(`unknown worker tool: ${name}`);

  const input = objectArgs(args);
  if (name === "ws_exec") return execOp(input);

  const path = safeRelativePath(input.path);
  const kind = FS_TOOL_KINDS[name];

  if (name === "ws_write") {
    if (typeof input.content !== "string") throw new Error("ws_write requires string content");
    if (!Object.prototype.hasOwnProperty.call(input, "encoding")) {
      return { op: "fs", kind, path, content: input.content };
    }
    if (input.encoding !== "text" && input.encoding !== "base64") {
      throw new Error('ws_write encoding must be "text" or "base64"');
    }
    return { op: "fs", kind, path, content: input.content, encoding: input.encoding };
  }

  if (name === "ws_read" && Object.prototype.hasOwnProperty.call(input, "encoding")) {
    throw new Error("ws_read does not accept encoding");
  }

  if (name === "ws_list" && Object.prototype.hasOwnProperty.call(input, "recursive")) {
    if (typeof input.recursive !== "boolean") throw new Error("ws_list recursive must be boolean");
    return { op: "fs", kind, path, recursive: input.recursive };
  }

  return { op: "fs", kind, path };
}

function isWorkerToolName(name: string): name is WorkerToolName {
  return (WORKER_TOOLS as readonly string[]).includes(name);
}

function objectArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("worker tool args must be an object");
  }
  return args as Record<string, unknown>;
}

function execOp(input: Record<string, unknown>): WorkerExecOp {
  if (typeof input.command !== "string" || input.command.trim() === "") {
    throw new Error("ws_exec requires a non-empty string command");
  }

  if (!Object.prototype.hasOwnProperty.call(input, "timeoutMs")) {
    return { op: "exec", command: input.command };
  }

  const timeoutMs = input.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("ws_exec timeoutMs must be a positive integer");
  }

  return { op: "exec", command: input.command, timeoutMs };
}
