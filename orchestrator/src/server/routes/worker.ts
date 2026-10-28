import { readFile } from "node:fs/promises";
import { appendAudit } from "../audit.js";
import { readAuthConfig } from "../auth.js";
import { currentAccountId, currentUsername } from "../auth-context.js";
import { safeRelativePath } from "../localfs/mcp-server.js";
import { readJsonBody } from "../read-body.js";
import type { WorkerFsOp } from "../worker/tool-surface.js";
import {
  addRevocation,
  parseRevocations,
  removeRevocation,
  revocationFilePath,
  saveRevocations,
  type RevocationState,
} from "../worker/worker-revocation.js";
import { getWorkerEndpoint } from "../worker/worker-runtime.js";
import { newMachineId, signWorkerToken } from "../worker/worker-token.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

const MACHINE_ID_PATTERN = /^[0-9a-f]{32}$/;
const FS_KINDS = new Set<WorkerFsOp["kind"]>([
  "read",
  "write",
  "list",
  "stat",
  "delete",
  "mkdir",
]);

function isFsKind(value: unknown): value is WorkerFsOp["kind"] {
  return typeof value === "string" && FS_KINDS.has(value as WorkerFsOp["kind"]);
}

async function readRevocations(): Promise<RevocationState> {
  let raw: string;
  try {
    raw = await readFile(revocationFilePath(), "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return { ok: true, list: [] };
    }
    throw error;
  }
  return parseRevocations(raw);
}

registerModularRoute({
  method: "GET",
  path: "/api/worker/revoked",
  handle: async (_req, res, _url, _context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    let state: RevocationState;
    try {
      state = await readRevocations();
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "吊销名单读取失败" }));
      return;
    }
    if (!state.ok) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: state.error }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      revoked: state.list.filter((entry) => entry.accountId === accountId),
    }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/worker/revoke",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    const body = await readJsonBody(req);
    const machineId = body.machineId;
    if (typeof machineId !== "string" || !MACHINE_ID_PATTERN.test(machineId)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "machineId 格式非法" }));
      return;
    }

    let state: RevocationState;
    try {
      state = await readRevocations();
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "吊销名单读取失败" }));
      return;
    }
    if (!state.ok) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: state.error }));
      return;
    }

    const now = Date.now();
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const next = addRevocation(state.list, {
      accountId,
      machineId,
      at: now,
      ...(reason === undefined ? {} : { reason }),
    });
    try {
      await saveRevocations(next);
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "吊销名单保存失败" }));
      return;
    }

    const endpoint = getWorkerEndpoint();
    const disconnected = endpoint?.disconnectMachine(
      accountId,
      machineId,
      "该工作机的 token 已被吊销",
    ) ?? false;
    await appendAudit(context.stateDir, {
      at: now,
      action: "worker-revoke",
      user: currentUsername(),
      detail: machineId,
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, disconnected }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/worker/unrevoke",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    const body = await readJsonBody(req);
    const machineId = body.machineId;
    if (typeof machineId !== "string" || !MACHINE_ID_PATTERN.test(machineId)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "machineId 格式非法" }));
      return;
    }

    let state: RevocationState;
    try {
      state = await readRevocations();
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "吊销名单读取失败" }));
      return;
    }
    if (!state.ok) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: state.error }));
      return;
    }

    const now = Date.now();
    const next = removeRevocation(state.list, accountId, machineId);
    try {
      await saveRevocations(next);
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "吊销名单保存失败" }));
      return;
    }
    await appendAudit(context.stateDir, {
      at: now,
      action: "worker-unrevoke",
      user: currentUsername(),
      detail: machineId,
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/worker/machines",
  handle: (_req, res) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    const endpoint = getWorkerEndpoint();
    if (endpoint === null) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "工作机通道未启用" }));
      return;
    }

    const machines = endpoint.registry.listByAccount(accountId).map((connection) => ({
      machineId: connection.machineId,
      machineName: connection.machineName,
      root: connection.root,
      connectedAt: connection.connectedAt,
    }));
    res.statusCode = 200;
    res.end(JSON.stringify({ machines }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/worker/token",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    // Attach request-stream listeners before the first await. IncomingMessage does
    // not replay an `end` event that fires while the auth config is being read.
    const bodyPromise = readJsonBody(req);
    const config = await readAuthConfig(context.stateDir);
    if (!config?.secret) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "未启用鉴权，无法签发工作机 token" }));
      return;
    }

    const body = await bodyPromise;
    const requestedMachineId = body.machineId;
    if (requestedMachineId !== undefined
      && (typeof requestedMachineId !== "string" || !MACHINE_ID_PATTERN.test(requestedMachineId))) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "machineId 格式非法" }));
      return;
    }

    const machineId = requestedMachineId ?? newMachineId();
    const now = Date.now();
    const token = signWorkerToken(accountId, machineId, config.secret, now);
    void appendAudit(context.stateDir, {
      at: now,
      action: "worker-token-mint",
      user: currentUsername(),
      detail: machineId,
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ token, machineId }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/worker/exec",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    const endpoint = getWorkerEndpoint();
    if (endpoint === null) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "工作机通道未启用" }));
      return;
    }

    const body = await readJsonBody(req);
    const machineId = body.machineId;
    if (typeof machineId !== "string" || !MACHINE_ID_PATTERN.test(machineId)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "machineId 格式非法" }));
      return;
    }

    const command = body.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "command 不能为空" }));
      return;
    }

    const requestedTimeoutMs = body.timeoutMs;
    if (requestedTimeoutMs !== undefined
      && (!Number.isInteger(requestedTimeoutMs)
        || typeof requestedTimeoutMs !== "number"
        || requestedTimeoutMs < 1
        || requestedTimeoutMs > 600_000)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "timeoutMs 非法" }));
      return;
    }
    const timeoutMs = requestedTimeoutMs ?? 600_000;

    const connection = endpoint.registry.findMachine(accountId, machineId);
    if (connection === null) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "该工作机不在线" }));
      return;
    }

    const conv = typeof body.conv === "string" ? body.conv : `worker-${machineId}`;
    const submitted = endpoint.execQueue.submit(conv, command, { timeoutMs });
    const pending = endpoint.execQueue.take(conv);
    if (pending === null) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "工作机连接已断开" }));
      return;
    }

    await appendAudit(context.stateDir, {
      at: Date.now(),
      action: "worker-exec",
      user: currentUsername(),
      detail: machineId,
    });
    if (!endpoint.dispatchExec(connection.connId, pending, timeoutMs)) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "工作机连接已断开" }));
      return;
    }

    const outcome = await submitted.result;
    res.statusCode = 200;
    res.end(JSON.stringify({ ...outcome, execId: submitted.execId }));
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/worker/fs",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const accountId = currentAccountId();
    if (!accountId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "未登录" }));
      return;
    }

    const endpoint = getWorkerEndpoint();
    if (endpoint === null) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "工作机通道未启用" }));
      return;
    }

    const body = await readJsonBody(req);
    const machineId = body.machineId;
    if (typeof machineId !== "string" || !MACHINE_ID_PATTERN.test(machineId)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "machineId 格式非法" }));
      return;
    }

    const kind = body.kind;
    if (!isFsKind(kind)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "kind 非法" }));
      return;
    }

    let path: string;
    try {
      path = safeRelativePath(body.path);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "path 非法" }));
      return;
    }

    if (kind === "write" && typeof body.content !== "string") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "write 需要 content" }));
      return;
    }

    const recursive = body.recursive;
    if (recursive !== undefined && typeof recursive !== "boolean") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "recursive 必须是布尔" }));
      return;
    }

    const requestedTimeoutMs = body.timeoutMs;
    if (requestedTimeoutMs !== undefined
      && (typeof requestedTimeoutMs !== "number"
        || !Number.isInteger(requestedTimeoutMs)
        || requestedTimeoutMs < 1
        || requestedTimeoutMs > 120_000)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "timeoutMs 非法" }));
      return;
    }
    const timeoutMs = requestedTimeoutMs ?? 30_000;

    const connection = endpoint.registry.findMachine(accountId, machineId);
    if (connection === null) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "该工作机不在线" }));
      return;
    }

    const op: WorkerFsOp = {
      op: "fs",
      kind,
      path,
      ...(kind === "write" ? { content: body.content as string } : {}),
      ...(recursive === undefined ? {} : { recursive }),
    };
    const conv = typeof body.conv === "string" ? body.conv : `worker-fs-${machineId}`;
    const submitted = endpoint.fsQueue.submit(conv, op, { timeoutMs });
    const pending = endpoint.fsQueue.take(conv);
    if (pending === null) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "工作机连接已断开" }));
      return;
    }

    await appendAudit(context.stateDir, {
      at: Date.now(),
      action: "worker-fs",
      user: currentUsername(),
      detail: `${kind} ${machineId}`,
    });
    if (!endpoint.dispatchFs(connection.connId, pending)) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "工作机连接已断开" }));
      return;
    }

    const outcome = await submitted.result;
    res.statusCode = 200;
    res.end(JSON.stringify({ ...outcome, opId: submitted.opId }));
  },
});
