import { lstat, mkdir, readFile, readdir, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import WebSocket from "ws";
import { safeRelativePath } from "../localfs/mcp-server.js";
import { createShellSession, type ShellSession } from "./shell-session.js";

const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 30_000;
const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_READ_BYTES = 5 * 1024 * 1024;
const MAX_LIST_ENTRIES = 2000;
const MAX_LIST_CHARS = 131_072;
const WORKER_PROTOCOL_VERSION = 1;

export interface BackoffOpts {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

export function nextBackoffMs(attempt: number, opts: BackoffOpts = {}): number {
  const baseMs = positiveInteger(opts.baseMs ?? DEFAULT_BASE_MS, DEFAULT_BASE_MS);
  const maxMs = positiveInteger(opts.maxMs ?? DEFAULT_MAX_MS, DEFAULT_MAX_MS);
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(1, Math.floor(attempt))
    : 1;
  const exponent = normalizedAttempt - 1;
  const full = exponent >= 53
    ? maxMs
    : Math.min(maxMs, baseMs * (2 ** exponent));
  const half = Math.ceil(full / 2);

  const sampled = opts.random?.() ?? Math.random();
  const random = Number.isFinite(sampled) ? Math.min(1, Math.max(0, sampled)) : 0;
  return Math.min(full, half + Math.floor(random * (full - half + 1)));
}

export type WorkerClientState =
  | "idle"
  | "connecting"
  | "online"
  | "reconnecting"
  | "stopped";

export interface WorkerClientSocket {
  send(data: string): void;
  close(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export interface WorkerSocketOptions {
  headers: Record<string, string>;
}

export interface WorkerClientOpts {
  url: string;
  token: string;
  machineName: string;
  root: string;
  shellFactory?: () => ShellSession;
  wsFactory?: (url: string, opts: WorkerSocketOptions) => WorkerClientSocket;
  backoff?: BackoffOpts;
  onStateChange?: (state: WorkerClientState) => void;
  maxOutputBytes?: number;
}

export interface WorkerClient {
  start(): void;
  stop(): Promise<void>;
  state(): WorkerClientState;
  attempts(): number;
}

interface ReadyMessage {
  type: "ready";
  connId: string;
  protocol: number;
}

interface ExecMessage {
  type: "exec";
  execId: string;
  command: string;
  timeoutMs: number;
}

interface FsMessage {
  type: "fs";
  opId: string;
  kind: unknown;
  path: unknown;
  content?: unknown;
  recursive?: unknown;
  encoding?: unknown;
}

type HostMessage = ReadyMessage | ExecMessage | FsMessage;

function parseHostMessage(data: unknown): HostMessage | null {
  const text = messageText(data);
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const message = parsed as Record<string, unknown>;
  if (message.type === "ready") {
    if (
      typeof message.connId !== "string"
      || message.protocol !== WORKER_PROTOCOL_VERSION
    ) return null;
    return {
      type: "ready",
      connId: message.connId,
      protocol: WORKER_PROTOCOL_VERSION,
    };
  }

  if (message.type === "exec") {
    if (
      typeof message.execId !== "string"
      || typeof message.command !== "string"
      || typeof message.timeoutMs !== "number"
      || !Number.isFinite(message.timeoutMs)
      || message.timeoutMs < 0
    ) return null;
    return {
      type: "exec",
      execId: message.execId,
      command: message.command,
      timeoutMs: message.timeoutMs,
    };
  }

  if (message.type === "fs") {
    if (typeof message.opId !== "string") return null;
    return {
      type: "fs",
      opId: message.opId,
      kind: message.kind,
      path: message.path,
      content: message.content,
      recursive: message.recursive,
      encoding: message.encoding,
    };
  }

  return null;
}

function messageText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (Array.isArray(data) && data.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(data).toString("utf8");
  }
  return null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown shell error";
}

async function listEntries(path: string, recursive: boolean): Promise<string> {
  const output: string[] = [];
  let outputChars = 0;
  let truncated = false;

  function collect(entry: string): boolean {
    const nextChars = outputChars + (output.length === 0 ? 0 : 1) + entry.length;
    if (nextChars > MAX_LIST_CHARS) {
      truncated = true;
      return false;
    }

    output.push(entry);
    outputChars = nextChars;
    if (output.length >= MAX_LIST_ENTRIES || outputChars >= MAX_LIST_CHARS) {
      truncated = true;
      return false;
    }
    return true;
  }

  async function visit(directory: string, prefix: string): Promise<void> {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const entryPath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!collect(`${entryPath}/`)) return;
        if (recursive) await visit(resolve(directory, entry.name), `${entryPath}/`);
      } else {
        if (!collect(entryPath)) return;
      }
      if (truncated) return;
    }
  }

  await visit(path, "");
  if (truncated) output.push(`…结果已截断（超过上限），共收集 ${output.length} 条`);
  return output.join("\n");
}

interface FsOperationResult {
  data?: string;
  encoding?: "text" | "base64";
}

async function executeFsOperation(root: string, message: FsMessage): Promise<FsOperationResult> {
  const relativePath = safeRelativePath(message.path);
  const path = resolve(root, relativePath);
  const realRoot = await realpath(root).catch(() => {
    throw new Error("文件操作越出工作目录：工作目录无法解析");
  });
  const isWithinRoot = (real: string): boolean => (
    real === realRoot || real.startsWith(`${realRoot}${sep}`)
  );
  const targetInfo = await lstat(path).catch(() => null);

  let checkedPath: string;
  if (targetInfo !== null) {
    const followsTargetSymlink = message.kind === "read"
      || message.kind === "write"
      || message.kind === "list"
      || message.kind === "stat";
    const pathToCheck = targetInfo.isSymbolicLink() && !followsTargetSymlink
      ? dirname(path)
      : path;
    checkedPath = await realpath(pathToCheck).catch(() => {
      throw new Error("文件操作越出工作目录：目标路径无法安全解析");
    });
  } else {
    let ancestor = dirname(path);
    let ancestorInfo = await lstat(ancestor).catch(() => null);
    while (ancestorInfo === null) {
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new Error("文件操作越出工作目录：找不到已存在的安全祖先目录");
      }
      ancestor = parent;
      ancestorInfo = await lstat(ancestor).catch(() => null);
    }
    checkedPath = await realpath(ancestor).catch(() => {
      throw new Error("文件操作越出工作目录：祖先路径无法安全解析");
    });
  }

  if (!isWithinRoot(checkedPath)) {
    throw new Error("文件操作越出工作目录");
  }

  switch (message.kind) {
    case "read": {
      const content = await readFile(path);
      const text = content.toString("utf8");
      const binary = content.includes(0) || !Buffer.from(text, "utf8").equals(content);
      if (binary && content.byteLength > MAX_BINARY_READ_BYTES) {
        throw new Error(`Binary file exceeds 5 MiB read limit: ${content.byteLength} bytes`);
      }
      if (!binary && content.byteLength > MAX_TEXT_READ_BYTES) {
        throw new Error(`File exceeds 2 MiB read limit: ${content.byteLength} bytes`);
      }
      return binary
        ? { data: content.toString("base64"), encoding: "base64" }
        : { data: text, encoding: "text" };
    }
    case "write": {
      if (typeof message.content !== "string") throw new Error("fs write requires string content");
      let content: string | Buffer = message.content;
      if (message.encoding === "base64") {
        const decoded = Buffer.from(message.content, "base64");
        const withoutPadding = (value: string): string => value.replace(/=+$/, "");
        if (withoutPadding(decoded.toString("base64")) !== withoutPadding(message.content)) {
          throw new Error("fs write content is not valid base64");
        }
        content = decoded;
      }
      await mkdir(dirname(path), { recursive: true });
      if (typeof content === "string") await writeFile(path, content, "utf8");
      else await writeFile(path, content);
      return {};
    }
    case "list":
      if (message.recursive !== undefined && typeof message.recursive !== "boolean") {
        throw new Error("fs list recursive must be boolean");
      }
      return { data: await listEntries(path, message.recursive === true) };
    case "stat": {
      const info = await stat(path);
      return {
        data: JSON.stringify({
          type: info.isDirectory() ? "dir" : "file",
          size: info.size,
          mtimeMs: info.mtimeMs,
        }),
      };
    }
    case "delete": {
      const info = await lstat(path);
      if (info.isDirectory()) await rmdir(path);
      else await unlink(path);
      return {};
    }
    case "mkdir":
      await mkdir(path, { recursive: true });
      return {};
    default:
      throw new Error(`Unknown fs kind: ${String(message.kind)}`);
  }
}

export function createWorkerClient(opts: WorkerClientOpts): WorkerClient {
  const shellFactory = opts.shellFactory ?? (() => createShellSession({ cwd: opts.root }));
  const wsFactory = opts.wsFactory ?? ((url, socketOpts) => (
    new WebSocket(url, socketOpts) as WorkerClientSocket
  ));

  let currentState: WorkerClientState = "idle";
  let reconnectAttempts = 0;
  let socket: WorkerClientSocket | undefined;
  let shell: ShellSession | undefined;
  let shellCreationError: unknown;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let execQueue: Promise<void> = Promise.resolve();

  function setState(next: WorkerClientState): void {
    if (currentState === next) return;
    currentState = next;
    try {
      opts.onStateChange?.(next);
    } catch {
      // State observers cannot affect the worker lifecycle.
    }
  }

  function redacted(value: string): string {
    return opts.token.length === 0 ? value : value.split(opts.token).join("[REDACTED]");
  }

  function ensureShell(): ShellSession | undefined {
    if (shell !== undefined) return shell;
    if (shellCreationError !== undefined) return undefined;
    try {
      shell = shellFactory();
    } catch (error) {
      shellCreationError = error;
    }
    return shell;
  }

  function disconnect(failedSocket: WorkerClientSocket): void {
    if (currentState === "stopped" || socket !== failedSocket) return;
    socket = undefined;
    try {
      failedSocket.close();
    } catch {
      // A failed socket may already be closed.
    }
    scheduleReconnect();
  }

  function send(failedSocket: WorkerClientSocket, message: Record<string, unknown>): boolean {
    if (currentState === "stopped" || socket !== failedSocket) return false;
    try {
      failedSocket.send(JSON.stringify(message));
      return true;
    } catch {
      disconnect(failedSocket);
      return false;
    }
  }

  function sendFailure(failedSocket: WorkerClientSocket, execId: string, error: unknown): void {
    const message = redacted(errorText(error));
    send(failedSocket, {
      type: "chunk",
      execId,
      stream: "stderr",
      data: `${message}\n`,
    });
  }

  async function execute(message: ExecMessage, sourceSocket: WorkerClientSocket): Promise<void> {
    try {
      const activeShell = ensureShell();
      if (activeShell === undefined) throw shellCreationError ?? new Error("Shell is unavailable");
      if (!activeShell.isAlive()) throw new Error("Shell session is closed");

      const result = await activeShell.run(message.command, {
        timeoutMs: message.timeoutMs,
        maxOutputBytes: opts.maxOutputBytes,
        onOutput: (stream, data) => {
          send(sourceSocket, {
            type: "chunk",
            execId: message.execId,
            stream,
            data,
          });
        },
      });

      const exitCode = result.exitCode ?? -1;
      if (result.timedOut) {
        sendFailure(
          sourceSocket,
          message.execId,
          new Error(`Shell command timed out after ${message.timeoutMs}ms`),
        );
      } else if (result.exitCode === null) {
        sendFailure(sourceSocket, message.execId, new Error("Shell command returned no exit code"));
      }
      send(sourceSocket, {
        type: "done",
        execId: message.execId,
        exitCode,
        truncated: result.truncated,
      });
    } catch (error) {
      sendFailure(sourceSocket, message.execId, error);
      send(sourceSocket, {
        type: "done",
        execId: message.execId,
        exitCode: -1,
        truncated: false,
      });
    }
  }

  async function executeFs(message: FsMessage, sourceSocket: WorkerClientSocket): Promise<void> {
    try {
      const result = await executeFsOperation(opts.root, message);
      send(sourceSocket, {
        type: "fsResult",
        opId: message.opId,
        ok: true,
        ...(result.data === undefined ? {} : { data: result.data }),
        ...(result.encoding === undefined ? {} : { encoding: result.encoding }),
      });
    } catch (error) {
      send(sourceSocket, {
        type: "fsResult",
        opId: message.opId,
        ok: false,
        error: redacted(errorText(error)),
      });
    }
  }

  function enqueue(message: ExecMessage | FsMessage, sourceSocket: WorkerClientSocket): void {
    const run = (): Promise<void> => message.type === "exec"
      ? execute(message, sourceSocket)
      : executeFs(message, sourceSocket);
    execQueue = execQueue.then(
      run,
      run,
    );
  }

  function receive(sourceSocket: WorkerClientSocket, data: unknown): void {
    if (currentState === "stopped" || socket !== sourceSocket) return;
    const message = parseHostMessage(data);
    if (message === null) return;

    if (message.type === "ready") {
      if (!send(sourceSocket, {
        type: "hello",
        machineName: opts.machineName,
        root: opts.root,
      })) return;
      reconnectAttempts = 0;
      setState("online");
      return;
    }

    enqueue(message, sourceSocket);
  }

  function beginConnect(): void {
    if (currentState === "stopped") return;
    setState("connecting");

    let nextSocket: WorkerClientSocket;
    try {
      nextSocket = wsFactory(opts.url, {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "X-Kunpeng-Worker-Protocol": String(WORKER_PROTOCOL_VERSION),
        },
      });
    } catch {
      scheduleReconnect();
      return;
    }

    socket = nextSocket;
    nextSocket.on("open", () => {
      // The server drives the handshake by sending ready.
    });
    nextSocket.on("message", (data) => {
      receive(nextSocket, data);
    });
    nextSocket.on("close", () => {
      disconnect(nextSocket);
    });
    nextSocket.on("error", () => {
      disconnect(nextSocket);
    });
  }

  function scheduleReconnect(): void {
    if (currentState === "stopped" || reconnectTimer !== undefined) return;
    reconnectAttempts += 1;
    setState("reconnecting");
    const delay = nextBackoffMs(reconnectAttempts, opts.backoff);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      beginConnect();
    }, delay);
  }

  return {
    start(): void {
      if (currentState !== "idle") return;
      ensureShell();
      beginConnect();
    },

    async stop(): Promise<void> {
      if (currentState === "stopped") return;
      setState("stopped");
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }

      const activeSocket = socket;
      socket = undefined;
      if (activeSocket !== undefined) {
        try {
          activeSocket.close();
        } catch {
          // stop() is deliberately idempotent, including failed sockets.
        }
      }
      if (shell !== undefined) {
        try {
          shell.close();
        } catch {
          // stop() must not fail because shell cleanup did.
        }
      }
    },

    state(): WorkerClientState {
      return currentState;
    },

    attempts(): number {
      return reconnectAttempts;
    },
  };
}
