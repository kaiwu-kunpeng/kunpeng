import { eraResponse, preflightMcp, withListCache, withResultType } from "../../mcp/protocol-era.js";
import { kunpengVersion } from "../../runtime/version.js";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  WORKER_TOOLS,
  toolToWorkerOp,
  type WorkerFsOp,
  type WorkerToolName,
} from "./tool-surface.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface WorkerExecResult {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
  timedOut?: unknown;
  truncated?: unknown;
}

interface WorkerFsResult {
  ok?: unknown;
  data?: unknown;
  error?: unknown;
  timedOut?: unknown;
  encoding?: unknown;
}

export interface WorkerMcpDeps {
  execUrl: string;
  fsUrl: string;
  machineId: string;
  conv: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface WorkerMcpToolSpec {
  name: WorkerToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "boolean";
      enum?: string[];
    }>;
    required: string[];
    additionalProperties: false;
  };
}

const TOOL_DESCRIPTIONS: Record<WorkerToolName, string> = {
  ws_read: "读取异地工作机上的文件；二进制会以纯 base64 返回。",
  ws_write: "写入异地工作机上的文件。",
  ws_list: "列出异地工作机上的目录内容。",
  ws_stat: "查看异地工作机上的文件或目录状态。",
  ws_delete: "删除异地工作机上的文件或目录。",
  ws_mkdir: "在异地工作机上创建目录。",
  ws_exec: "在异地工作机上执行命令。",
};

export function workerToolSpec(name: WorkerToolName): WorkerMcpToolSpec {
  if (name === "ws_exec") {
    return {
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["command"],
        additionalProperties: false,
      },
    };
  }

  return {
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ...(name === "ws_write" ? {
          content: { type: "string" as const },
          encoding: { type: "string" as const, enum: ["text", "base64"] },
        } : {}),
        ...(name === "ws_list" ? { recursive: { type: "boolean" as const } } : {}),
      },
      required: name === "ws_write" ? ["path", "content"] : ["path"],
      additionalProperties: false,
    },
  };
}

export async function handleWorkerMcpRequest(
  line: string,
  deps: WorkerMcpDeps,
): Promise<unknown | null> {
  let request: JsonRpcRequest;
  try {
    const parsed: unknown = JSON.parse(line);
    request = isObject(parsed) ? parsed : {};
  } catch (error) {
    return jsonRpcError(null, -32700, safeErrorMessage(error, deps.token));
  }

  if (request.id === undefined || request.id === null) return null;
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return jsonRpcError(null, -32000, "JSON-RPC id must be a string or number");
  }
  const id = request.id;

  try {
    const era = preflightMcp(request.method, request.params, { name: "kunpeng-worker", version: kunpengVersion() });
    if (era) return eraResponse(id, era);

    if (request.method === "tools/list") {
      return jsonRpcResult(id, withListCache(request.params, { tools: WORKER_TOOLS.map(workerToolSpec) }));
    }

    if (request.method === "tools/call") {
      const params = objectParams(request.params);
      const name = params.name;
      if (typeof name !== "string") throw new Error("tools/call requires tool name");

      const op = toolToWorkerOp(name, params.arguments ?? {});
      if (op.op === "fs") {
        const result = await executeWorkerFs(op, deps);
        return jsonRpcResult(id, withResultType(request.params, fsResultToToolResponse(result, deps.token)));
      }

      const result = await executeWorkerCommand(op, deps);
      return jsonRpcResult(id, withResultType(request.params, execResultToToolResponse(result, deps.token)));
    }

    return jsonRpcError(
      id,
      -32601,
      redactToken(`method not found: ${String(request.method ?? "(missing)")}`, deps.token),
    );
  } catch (error) {
    return jsonRpcError(id, -32000, safeErrorMessage(error, deps.token));
  }
}

export async function runWorkerMcpServer(deps: Partial<WorkerMcpDeps> = {}): Promise<void> {
  const resolvedDeps: WorkerMcpDeps = {
    execUrl: deps.execUrl ?? requireEnv("KUNPENG_WORKER_EXEC_URL"),
    fsUrl: deps.fsUrl ?? requireEnv("KUNPENG_WORKER_FS_URL"),
    machineId: deps.machineId ?? requireEnv("KUNPENG_WORKER_MACHINE_ID"),
    conv: deps.conv ?? requireEnv("KUNPENG_WORKER_CONV"),
    token: deps.token ?? process.env.KUNPENG_SESSION_TOKEN,
    fetchImpl: deps.fetchImpl,
  };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const response = await handleWorkerMcpRequest(text, resolvedDeps);
    if (response !== null) await writeJsonRpcResponse(response);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectParams(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("tools/call params must be an object");
  return value;
}

async function executeWorkerCommand(
  op: { command: string; timeoutMs?: number },
  deps: WorkerMcpDeps,
): Promise<WorkerExecResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (deps.token) headers.cookie = `kp_session=${deps.token}`;
  const body = {
    machineId: deps.machineId,
    command: op.command,
    conv: deps.conv,
    ...(op.timeoutMs === undefined ? {} : { timeoutMs: op.timeoutMs }),
  };
  const response = await (deps.fetchImpl ?? fetch)(deps.execUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`worker exec HTTP ${response.status}`);

  const result: unknown = await response.json();
  if (!isObject(result)) throw new Error("worker exec returned an invalid JSON result");
  return result;
}

async function executeWorkerFs(
  op: WorkerFsOp,
  deps: WorkerMcpDeps,
): Promise<WorkerFsResult> {
  if (!deps.fsUrl) throw new Error("KUNPENG_WORKER_FS_URL is required");

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (deps.token) headers.cookie = `kp_session=${deps.token}`;
  const body = {
    machineId: deps.machineId,
    kind: op.kind,
    path: op.path,
    conv: deps.conv,
    ...(op.content === undefined ? {} : { content: op.content }),
    ...(op.recursive === undefined ? {} : { recursive: op.recursive }),
  };
  const response = await (deps.fetchImpl ?? fetch)(deps.fsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`worker fs HTTP ${response.status}`);

  const result: unknown = await response.json();
  if (!isObject(result)) throw new Error("worker fs returned an invalid JSON result");
  return result;
}

function execResultToToolResponse(result: WorkerExecResult, token?: string): unknown {
  const exitCode = result.exitCode;
  const timedOut = result.timedOut === true;
  const lines = [`exit code: ${String(exitCode ?? "null")}`];
  if (timedOut) lines.push("状态: 超时");
  if (result.truncated === true) lines.push("状态: 输出已截断");
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    lines.push(`stdout:\n${result.stdout}`);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    lines.push(`stderr:\n${result.stderr}`);
  }
  return {
    content: [{ type: "text", text: redactToken(lines.join("\n"), token) }],
    isError: exitCode !== 0 || timedOut,
  };
}

function fsResultToToolResponse(result: WorkerFsResult, token?: string): unknown {
  const ok = result.ok === true;
  const data = typeof result.data === "string" ? result.data : "已完成";
  const text = ok
    ? (result.encoding === "base64"
        ? `[二进制文件，base64 共 ${data.length} 字符，如需落盘请用 ws_write 原样写回并带 encoding:"base64"]\n${data}`
        : data)
    : (typeof result.error === "string" ? result.error : "文件操作失败");
  const withStatus = result.timedOut === true ? `${text}\n状态: 超时` : text;
  return {
    content: [{ type: "text", text: redactToken(withStatus, token) }],
    isError: !ok,
  };
}

function safeErrorMessage(error: unknown, token?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactToken(message, token);
}

function redactToken(text: string, token?: string): string {
  return token ? text.split(token).join("[REDACTED]") : text;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonRpcResult(id: Exclude<JsonRpcId, null>, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function writeJsonRpcResponse(response: unknown): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(`${JSON.stringify(response)}\n`, () => resolve());
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runWorkerMcpServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
