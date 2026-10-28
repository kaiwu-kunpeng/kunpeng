import { eraResponse, preflightMcp, withListCache, withResultType } from "../../mcp/protocol-era.js";
import { kunpengVersion } from "../../runtime/version.js";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isAbsolute, normalize, win32 } from "node:path";
import type { LocalFsOp, LocalFsOpKind, LocalFsResult } from "./types.js";

export const LOCALFS_TOOLS = [
  "localfs_read",
  "localfs_write",
  "localfs_list",
  "localfs_stat",
  "localfs_delete",
  "localfs_mkdir",
] as const;

type LocalFsToolName = (typeof LOCALFS_TOOLS)[number];
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

const TOOL_KIND: Record<LocalFsToolName, LocalFsOpKind> = {
  localfs_read: "read",
  localfs_write: "write",
  localfs_list: "list",
  localfs_stat: "stat",
  localfs_delete: "delete",
  localfs_mkdir: "mkdir",
};

export function toolToOp(name: string, args: unknown): Omit<LocalFsOp, "opId" | "conv"> {
  if (!isLocalFsToolName(name)) throw new Error(`unknown localfs tool: ${name}`);
  const input = objectArgs(args);
  const path = safeRelativePath(input.path);
  const kind = TOOL_KIND[name];
  if (name === "localfs_list" && Object.prototype.hasOwnProperty.call(input, "recursive")) {
    if (typeof input.recursive !== "boolean") throw new Error("localfs_list recursive must be boolean");
    return { kind, path, recursive: input.recursive };
  }
  if (kind !== "write") return { kind, path };

  if (typeof input.content !== "string") throw new Error("localfs_write requires string content");
  return { kind, path, content: input.content };
}

export async function runLocalFsMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const enqueueUrl = requireEnv(env, "KP_LOCALFS_ENQUEUE_URL");
  const conv = requireEnv(env, "KP_LOCALFS_CONV");
  // 当 cockpit 开启鉴权(auth.json)后,/api/localfs/* 走 decideAuth,无 kp_session cookie 一律 401。
  // 本进程是 claude 在本机 spawn 的子进程、自身没有会话,所以由 chat 接线把当前用户的会话 token
  // 经 KP_LOCALFS_TOKEN 注入进来,enqueue 时当 cookie 带上,才能穿透鉴权门把 op 投进队列。
  const token = env.KP_LOCALFS_TOKEN ?? "";
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    await writeJsonRpcResponse(await handleLocalFsMcpRequest(text, enqueueUrl, conv, token));
  }
}

function isLocalFsToolName(name: string): name is LocalFsToolName {
  return (LOCALFS_TOOLS as readonly string[]).includes(name);
}

function objectArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("localfs tool args must be an object");
  }
  return args as Record<string, unknown>;
}

export function safeRelativePath(value: unknown): string {
  if (typeof value !== "string") throw new Error("localfs path is required");
  if (value.includes("\0")) throw new Error("localfs path contains NUL");
  const raw = value.trim();
  if (raw === "" || raw === "/" || raw === "." || raw === "./") return "";
  if (isAbsolute(raw) || win32.isAbsolute(raw)) throw new Error("localfs path must be relative");

  const parts = raw.split(/[\\/]+/);
  if (parts.includes("..")) throw new Error("localfs path must not contain ..");

  const normalized = normalize(raw).replace(/\\/g, "/");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("localfs path escapes root");
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function handleLocalFsMcpRequest(line: string, enqueueUrl: string, conv: string, token = ""): Promise<unknown | null> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    return jsonRpcError(null, -32700, String(error));
  }

  if (req.id === undefined || req.id === null) return null;

  try {
    const era = preflightMcp(req.method, req.params, { name: "kunpeng-localfs", version: kunpengVersion() });
    if (era) return eraResponse(req.id, era);

    if (req.method === "tools/list") {
      return jsonRpcResult(req.id, withListCache(req.params, { tools: LOCALFS_TOOLS.map(toolSpec) }));
    }

    if (req.method === "tools/call") {
      const params = objectArgs(req.params);
      const name = params.name;
      if (typeof name !== "string") throw new Error("tools/call requires tool name");
      const op = toolToOp(name, params.arguments ?? {});
      const result = await enqueueLocalFsOp(enqueueUrl, conv, op, token);
      return jsonRpcResult(req.id, withResultType(req.params, resultToToolResponse(result)));
    }

    return jsonRpcError(req.id, -32601, `method not found: ${req.method ?? "(missing)"}`);
  } catch (error) {
    return jsonRpcError(req.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function toolSpec(name: LocalFsToolName): unknown {
  const description = name === "localfs_read"
    ? "Read a path from the browser-authorized local directory. Text is returned directly (first 2 MiB maximum); binary is returned as pure base64 (5 MiB file maximum, without a data URL prefix)."
    : `Use the browser-authorized local directory to ${TOOL_KIND[name]} a path.`;
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ...(name === "localfs_list" ? { recursive: { type: "boolean" } } : {}),
        ...(name === "localfs_write" ? { content: { type: "string" } } : {}),
      },
      required: name === "localfs_write" ? ["path", "content"] : ["path"],
      additionalProperties: false,
    },
  };
}

async function enqueueLocalFsOp(
  enqueueUrl: string,
  conv: string,
  op: Omit<LocalFsOp, "opId" | "conv">,
  token = "",
): Promise<LocalFsResult> {
  const url = new URL(enqueueUrl);
  url.searchParams.set("conv", conv);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = `kp_session=${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(op),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`localfs enqueue HTTP ${response.status}: ${body}`);
  return JSON.parse(body) as LocalFsResult;
}

function resultToToolResponse(result: LocalFsResult): unknown {
  const data = result.data ?? "OK";
  const text = result.ok && result.encoding === "base64"
    ? `[二进制文件,base64 共 ${data.length} 字符,如需落盘请用 write 原样写回或告知用户]\n${data}`
    : result.ok
      ? data
      : (result.error ?? "localfs failed");
  return {
    content: [{ type: "text", text }],
    isError: !result.ok,
  };
}

function jsonRpcResult(id: string | number | null, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function writeJsonRpcResponse(response: unknown | null): Promise<void> {
  if (response === null) return;
  await new Promise<void>((resolve) => {
    process.stdout.write(`${JSON.stringify(response)}\n`, () => resolve());
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLocalFsMcpServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
