import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { registerUpgradeRoute, rejectUpgrade as rejectSharedUpgrade } from "../ws-upgrade-router.js";
import {
  createExecQueue,
  type ExecQueue,
  type PendingExec,
} from "./exec-queue.js";
import {
  createFsQueue,
  type FsQueue,
  type PendingFsOp,
} from "./fs-queue.js";
import { attachWorkerSocket, type AttachedWorkerSocket } from "./socket-lifecycle.js";
import {
  createWorkerConnectionRegistry,
  type WorkerConnectionRegistry,
} from "./worker-connections.js";
import {
  checkWorkerProtocol,
  verifyWorkerToken,
  WORKER_PROTOCOL_VERSION,
} from "./worker-token.js";
import {
  isRevoked,
  parseRevocations,
  revocationFilePath,
  type RevocationState,
} from "./worker-revocation.js";

export const WORKER_WS_PATH = "/api/worker/connect";
export const MAX_MACHINES_PER_ACCOUNT = 16;

const DEFAULT_MAX_TOKEN_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGE_BYTES = 1_048_576;
const MAX_MACHINE_NAME_CHARS = 80;
const MAX_ROOT_CHARS = 512;
const WORKER_DISCONNECTED_MESSAGE = "工作机连接已断开";
const FS_FAILURE_DISCONNECT_GRACE_MS = 250;

export interface WorkerEndpointOpts {
  resolveSecret: () => Promise<string | null>;
  resolveRevocations?: () => Promise<RevocationState>;
  registry?: WorkerConnectionRegistry;
  execQueue?: ExecQueue;
  fsQueue?: FsQueue;
  now?: () => number;
  maxTokenAgeMs?: number;
  maxMessageBytes?: number;
  maxMachinesPerAccount?: number;
}

export interface WorkerEndpoint {
  registry: WorkerConnectionRegistry;
  execQueue: ExecQueue;
  fsQueue: FsQueue;
  dispatchExec(connId: string, pending: PendingExec, timeoutMs: number): boolean;
  dispatchFs(connId: string, pending: PendingFsOp): boolean;
  disconnectMachine(accountId: string, machineId: string, reason: string): boolean;
  close(): void;
}

interface ActiveConnection {
  ws: WebSocket;
  execQueue: ExecQueue;
  fsQueue: FsQueue;
  claimedExecIds: Set<string>;
  claimedFsIds: Set<string>;
}

const activeConnections = new Map<string, ActiveConnection>();

export function dispatchExec(
  connId: string,
  pending: PendingExec,
  timeoutMs: number,
): boolean {
  const connection = activeConnections.get(connId);
  if (!connection || connection.ws.readyState !== connection.ws.OPEN) return false;

  try {
    connection.ws.send(JSON.stringify({
      type: "exec",
      execId: pending.execId,
      command: pending.command,
      timeoutMs,
    }));
    connection.claimedExecIds.add(pending.execId);
    return true;
  } catch {
    return false;
  }
}

export function dispatchFs(connId: string, pending: PendingFsOp): boolean {
  const connection = activeConnections.get(connId);
  if (!connection || connection.ws.readyState !== connection.ws.OPEN) return false;

  try {
    connection.ws.send(JSON.stringify({
      type: "fs",
      opId: pending.opId,
      kind: pending.op.kind,
      path: pending.op.path,
      content: pending.op.content,
      recursive: pending.op.recursive,
      ...(pending.op.encoding === undefined ? {} : { encoding: pending.op.encoding }),
    }));
    connection.claimedFsIds.add(pending.opId);
    return true;
  } catch {
    return false;
  }
}

export function attachWorkerWebSocket(server: Server, opts: WorkerEndpointOpts): WorkerEndpoint {
  const registry = opts.registry ?? createWorkerConnectionRegistry();
  const execQueue = opts.execQueue ?? createExecQueue();
  const fsQueue = opts.fsQueue ?? createFsQueue();
  const now = opts.now ?? Date.now;
  const maxTokenAgeMs = opts.maxTokenAgeMs ?? DEFAULT_MAX_TOKEN_AGE_MS;
  const maxMessageBytes = opts.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const maxMachinesPerAccount = opts.maxMachinesPerAccount ?? MAX_MACHINES_PER_ACCOUNT;
  const resolveRevocations = opts.resolveRevocations ?? readRevocations;
  const wss = new WebSocketServer({ noServer: true });
  const endpointConnections = new Map<string, {
    ws: WebSocket;
    attached: AttachedWorkerSocket | null;
  }>();
  let closed = false;

  wss.on("error", (error) => {
    console.error("[worker] WebSocket server error:", error);
  });

  const unregisterRoute = registerUpgradeRoute(server, {
    name: "worker",
    matches: (path) => path === WORKER_WS_PATH,
    handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on("error", () => {
        socket.destroy();
      });

      void handleUpgrade(req, socket, head, {
        wss,
        registry,
        execQueue,
        fsQueue,
        endpointConnections,
        resolveSecret: opts.resolveSecret,
        resolveRevocations,
        now,
        maxTokenAgeMs,
        maxMessageBytes,
        maxMachinesPerAccount,
        isClosed: () => closed,
      }).catch(() => {
        socket.destroy();
      });
    },
  });

  return {
    registry,
    execQueue,
    fsQueue,
    dispatchExec,
    dispatchFs,
    disconnectMachine(accountId, machineId, reason): boolean {
      const machine = registry.findMachine(accountId, machineId);
      if (machine === null) return false;

      const endpointConnection = endpointConnections.get(machine.connId);
      const ws = endpointConnection?.ws ?? activeConnections.get(machine.connId)?.ws;
      if (ws === undefined) {
        registry.unregister(machine.connId);
        return true;
      }

      try {
        ws.send(JSON.stringify({
          type: "error",
          reason: "revoked",
          message: reason,
        }));
      } catch {
        // A failed notification must not prevent revocation from closing the socket.
      }

      try {
        ws.close();
      } catch {
        try {
          ws.terminate();
        } catch {
          // The socket may already be closed.
        }
      } finally {
        forgetWorkerConnection(machine.connId, ws, endpointConnections);
        endpointConnection?.attached?.detach();
      }
      return true;
    },
    close(): void {
      if (closed) return;
      closed = true;
      unregisterRoute();

      for (const [connId, connection] of [...endpointConnections]) {
        forgetWorkerConnection(connId, connection.ws, endpointConnections);
        connection.attached?.detach();
        try {
          connection.ws.terminate();
        } catch {
          // The connection may already be closed.
        }
      }

      try {
        wss.close(() => {});
      } catch {
        // close() is deliberately idempotent even if ws has already stopped.
      }
    },
  };
}

interface UpgradeContext {
  wss: WebSocketServer;
  registry: WorkerConnectionRegistry;
  execQueue: ExecQueue;
  fsQueue: FsQueue;
  endpointConnections: Map<string, {
    ws: WebSocket;
    attached: AttachedWorkerSocket | null;
  }>;
  resolveSecret: () => Promise<string | null>;
  resolveRevocations: () => Promise<RevocationState>;
  now: () => number;
  maxTokenAgeMs: number;
  maxMessageBytes: number;
  maxMachinesPerAccount: number;
  isClosed: () => boolean;
}

async function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: UpgradeContext,
): Promise<void> {
  if (req.headers.origin !== undefined) {
    rejectUpgrade(socket, "403 Forbidden");
    return;
  }

  const authorization = firstHeader(req.headers.authorization);
  if (!authorization?.startsWith("Bearer ")) {
    rejectUpgrade(socket, "401 Unauthorized");
    return;
  }

  let secret: string | null;
  try {
    secret = await ctx.resolveSecret();
  } catch {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }
  if (secret === null) {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }

  const verified = verifyWorkerToken(
    authorization.slice("Bearer ".length),
    secret,
    ctx.now(),
    ctx.maxTokenAgeMs,
  );
  if (verified === null) {
    rejectUpgrade(socket, "401 Unauthorized");
    return;
  }

  // 拒绝名单只检查新握手，不主动踢掉已在线连接；读取或解析失败一律 fail-closed。
  let revocations: RevocationState;
  try {
    revocations = await ctx.resolveRevocations();
  } catch {
    rejectSharedUpgrade(socket, "403 Forbidden", {
      message: `工作机吊销名单读取失败；删除 ${revocationFilePath()} 可恢复连接`,
    });
    return;
  }
  if (!revocations.ok) {
    rejectSharedUpgrade(socket, "403 Forbidden", {
      message: `工作机吊销名单损坏：${revocations.error}；删除 ${revocationFilePath()} 可恢复连接`,
    });
    return;
  }
  if (isRevoked(revocations.list, verified.accountId, verified.machineId)) {
    rejectSharedUpgrade(socket, "403 Forbidden", {
      message: "该工作机已被吊销",
    });
    return;
  }

  const protocolVersion = Number(firstHeader(req.headers["x-kunpeng-worker-protocol"]));
  const protocol = checkWorkerProtocol(protocolVersion);
  if (!protocol.ok) {
    rejectUpgrade(socket, "426 Upgrade Required", {
      "X-Kunpeng-Reason": protocol.reason,
    });
    return;
  }

  if (ctx.isClosed()) {
    socket.destroy();
    return;
  }

  try {
    ctx.wss.handleUpgrade(req, socket, head, (ws) => {
      const connId = randomUUID();
      const claimedExecIds = new Set<string>();
      const claimedFsIds = new Set<string>();
      const endpointConnection = { ws, attached: null as AttachedWorkerSocket | null };
      ctx.endpointConnections.set(connId, endpointConnection);
      activeConnections.set(connId, {
        ws,
        execQueue: ctx.execQueue,
        fsQueue: ctx.fsQueue,
        claimedExecIds,
        claimedFsIds,
      });

      const forgetConnection = (): void => {
        forgetWorkerConnection(connId, ws, ctx.endpointConnections);
      };
      ws.on("close", forgetConnection);
      ws.on("error", forgetConnection);
      ws.on("message", (data, isBinary) => {
        try {
          handleMessage(data, isBinary, {
            connId,
            ws,
            accountId: verified.accountId,
            machineId: verified.machineId,
            registry: ctx.registry,
            execQueue: ctx.execQueue,
            fsQueue: ctx.fsQueue,
            claimedExecIds,
            claimedFsIds,
            maxMessageBytes: ctx.maxMessageBytes,
            maxMachinesPerAccount: ctx.maxMachinesPerAccount,
            now: ctx.now,
            getAttached: () => endpointConnection.attached,
            setAttached: (attached) => {
              endpointConnection.attached = attached;
            },
          });
        } catch {
          // Worker messages are untrusted input; one bad message must not escape the handler.
        }
      });

      setTimeout(() => {
        if (ws.readyState !== ws.OPEN) {
          forgetConnection();
          return;
        }

        try {
          ws.send(JSON.stringify({
            type: "ready",
            connId,
            protocol: WORKER_PROTOCOL_VERSION,
          }));
        } catch {
          forgetConnection();
          try {
            ws.terminate();
          } catch {
            // The failed send may already have closed the socket.
          }
        }
      }, 10);
    });
  } catch {
    socket.destroy();
  }
}

function forgetWorkerConnection(
  connId: string,
  ws: WebSocket,
  endpointConnections: UpgradeContext["endpointConnections"],
): void {
  const active = activeConnections.get(connId);
  if (active?.ws === ws) {
    for (const execId of active.claimedExecIds) {
      active.execQueue.abort(execId, WORKER_DISCONNECTED_MESSAGE);
    }
    for (const opId of active.claimedFsIds) {
      active.fsQueue.settle(opId, { ok: false, error: WORKER_DISCONNECTED_MESSAGE });
    }
    active.claimedExecIds.clear();
    active.claimedFsIds.clear();
    activeConnections.delete(connId);
  }
  endpointConnections.delete(connId);
}

interface MessageContext {
  connId: string;
  ws: WebSocket;
  accountId: string;
  machineId: string;
  registry: WorkerConnectionRegistry;
  execQueue: ExecQueue;
  fsQueue: FsQueue;
  claimedExecIds: Set<string>;
  claimedFsIds: Set<string>;
  maxMessageBytes: number;
  maxMachinesPerAccount: number;
  now: () => number;
  getAttached: () => AttachedWorkerSocket | null;
  setAttached: (attached: AttachedWorkerSocket) => void;
}

function handleMessage(data: RawData, isBinary: boolean, ctx: MessageContext): void {
  if (isBinary) return;

  const bytes = rawDataBuffer(data);
  if (bytes.byteLength > ctx.maxMessageBytes) return;

  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    message = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof message.type !== "string") return;

  if (ctx.getAttached() === null) {
    if (message.type !== "hello") return;

    if (
      !ctx.registry.isMachineOnline(ctx.accountId, ctx.machineId)
      && ctx.registry.listByAccount(ctx.accountId).length >= ctx.maxMachinesPerAccount
    ) {
      try {
        ctx.ws.send(JSON.stringify({
          type: "error",
          reason: "machine-limit",
          message: `该账号在线工作机已达上限 ${ctx.maxMachinesPerAccount} 台`,
        }));
      } finally {
        ctx.ws.close();
      }
      return;
    }

    const machineName = truncateChars(
      typeof message.machineName === "string" && message.machineName.trim() !== ""
        ? message.machineName
        : ctx.machineId.slice(0, 8),
      MAX_MACHINE_NAME_CHARS,
    );
    const root = truncateChars(
      typeof message.root === "string" ? message.root : "",
      MAX_ROOT_CHARS,
    );
    ctx.setAttached(attachWorkerSocket({
      registry: ctx.registry,
      socket: ctx.ws,
      connection: {
        connId: ctx.connId,
        accountId: ctx.accountId,
        machineId: ctx.machineId,
        machineName,
        root,
        connectedAt: ctx.now(),
      },
    }));
    return;
  }

  if (message.type === "hello") return;
  if (message.type === "fsResult") {
    if (typeof message.opId !== "string" || !ctx.claimedFsIds.has(message.opId)) return;
    if (typeof message.ok !== "boolean") return;

    const opId = message.opId;
    const outcome = {
      ok: message.ok,
      ...(typeof message.data === "string" ? { data: message.data } : {}),
      ...(typeof message.error === "string" ? { error: message.error } : {}),
      ...(message.encoding === "text" || message.encoding === "base64"
        ? { encoding: message.encoding }
        : {}),
    };
    const settle = (): void => {
      if (!ctx.claimedFsIds.has(opId)) return;
      ctx.fsQueue.settle(opId, outcome);
      ctx.claimedFsIds.delete(opId);
    };
    if (message.ok) settle();
    else setTimeout(settle, FS_FAILURE_DISCONNECT_GRACE_MS);
    return;
  }
  if (typeof message.execId !== "string" || !ctx.claimedExecIds.has(message.execId)) return;

  if (message.type === "chunk") {
    if (
      (message.stream !== "stdout" && message.stream !== "stderr")
      || typeof message.data !== "string"
    ) return;
    ctx.execQueue.pushChunk(message.execId, message.stream, message.data);
    return;
  }

  if (message.type === "done") {
    if (typeof message.exitCode !== "number" || !Number.isFinite(message.exitCode)) return;
    if (ctx.execQueue.complete(message.execId, {
      exitCode: message.exitCode,
      truncated: typeof message.truncated === "boolean" ? message.truncated : undefined,
    })) {
      ctx.claimedExecIds.delete(message.execId);
    }
  }
}

function truncateChars(value: string, maxChars: number): string {
  return [...value].slice(0, maxChars).join("");
}

function rawDataBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRevocations(): Promise<RevocationState> {
  let raw: string;
  try {
    raw = await readFile(revocationFilePath(), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { ok: true, list: [] };
    throw error;
  }
  return parseRevocations(raw);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT"
  );
}

function rejectUpgrade(
  socket: Duplex,
  status: string,
  headers: Record<string, string> = {},
): void {
  rejectSharedUpgrade(socket, status, { headers });
}
