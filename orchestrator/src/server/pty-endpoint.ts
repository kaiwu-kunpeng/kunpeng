import type { Server, IncomingMessage } from "node:http";
import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { PtySessionPool, type PtySessionInfo } from "./pty-pool.js";
import { nodePtyFactory } from "./pty-node-factory.js";
import { isAllowedWsOrigin } from "./ws-origin.js";
import { isTrustedLocalRequest, readAuthConfig, verifySession, parseCookies, SESSION_MAX_AGE_MS } from "./auth.js";
import { requestAuthContext } from "./auth-context.js";
import { authorizeRequest, explainAuthzDenial, resolveAuthzPolicy } from "./authz.js";
import { readJsonBody } from "./read-body.js";
import { registerUpgradeRoute, rejectUpgrade } from "./ws-upgrade-router.js";

export interface PtyEndpointOpts {
  /** 鉴权配置目录(同 dashboard 的 stateDir);存在 auth.json 则强制校验。 */
  stateDir: string;
  /** workspaceId → 该工作区仓库根(新会话的 shell cwd)。 */
  resolveCwd: (workspaceId: string) => Promise<string>;
  /** 尝试把指定会话 id 复活回 pool；成功时应已创建同 id 会话。 */
  revive?: (id: string, workspaceId: string) => Promise<boolean>;
  /** 可注入(测试);默认真实 node-pty 池。 */
  pool?: PtySessionPool;
  now?: () => number;
  reapIntervalMs?: number;
  pingIntervalMs?: number;
}

const PTY_PATH = /^\/api\/workspace\/([^/]+)\/pty$/;
const PTY_SESSIONS_PATH = /^\/api\/workspace\/([^/]+)\/pty\/sessions(?:\/([^/]+))?$/;

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function backpressureDecision(
  bufferedAmount: number,
  paused: boolean,
  highWater = 128 * 1024,
  lowWater = 16 * 1024,
): "pause" | "resume" | "none" {
  if (!paused && bufferedAmount > highWater) return "pause";
  if (paused && bufferedAmount < lowWater) return "resume";
  return "none";
}

export function clampPtyDims(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: clampPtyDim(cols, 80, 500),
    rows: clampPtyDim(rows, 24, 200),
  };
}

function clampPtyDim(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 2 ? Math.min(parsed, maximum) : fallback;
}

export async function resolveSessionForConnection(
  ctx: { wantSession?: string; workspaceId: string },
  deps: { aliveWorkspace: (id: string) => string | undefined; revive?: (id: string, workspaceId: string) => Promise<boolean> },
): Promise<{ id: string | undefined; revived: boolean; mismatch?: true }> {
  if (!ctx.wantSession) return { id: undefined, revived: false };
  const aliveWorkspace = deps.aliveWorkspace(ctx.wantSession);
  if (aliveWorkspace === ctx.workspaceId) return { id: ctx.wantSession, revived: false };
  if (aliveWorkspace !== undefined) return { id: undefined, revived: false, mismatch: true };
  if (!deps.revive) return { id: undefined, revived: false };

  try {
    if (await deps.revive(ctx.wantSession, ctx.workspaceId)) {
      return { id: ctx.wantSession, revived: true };
    }
  } catch {
    // Revive is best-effort; a failed tmux/registry probe must degrade to new-session creation.
  }
  return { id: undefined, revived: false };
}

interface ConnCtx {
  pool: PtySessionPool;
  workspaceId: string;
  accountId?: string;
  profileId?: string;
  username?: string;
  wantSession?: string;
  cols: number;
  rows: number;
  resolveCwd: (workspaceId: string) => Promise<string>;
  revive?: (id: string, workspaceId: string) => Promise<boolean>;
  now: () => number;
}

/**
 * 给 http.Server 挂上 PTY WebSocket 升级处理(常驻 shell 会话池,远程驱动第二期)。
 * 路由 /api/workspace/:id/pty?session=&cols=&rows= 。返回会话池(供关停清理)。
 * 安全:auth.json 存在则升级前必须持有效 kp_session,否则 401 销毁——远程开 shell 是高权操作。
 */
export function attachPtyWebSocket(server: Server, opts: PtyEndpointOpts): PtySessionPool {
  const pool = opts.pool ?? new PtySessionPool({ factory: nodePtyFactory });
  const now = opts.now ?? (() => Date.now());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  wss.on("error", (error) => {
    console.error("[pty] WebSocket server error:", error);
  });
  const reapIntervalMs = opts.reapIntervalMs ?? 60_000;
  const reapTimer = setInterval(() => {
    try {
      pool.reap();
    } catch {
      // Reaping is best-effort; a transient pool error must not kill the server.
    }
  }, reapIntervalMs);
  reapTimer.unref?.();
  const pingIntervalMs = opts.pingIntervalMs ?? 30_000;
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      try {
        if (ws.readyState === ws.OPEN) ws.ping();
      } catch {
        // Heartbeats are best-effort; one broken connection must not block the others.
      }
    }
  }, pingIntervalMs);
  pingTimer.unref?.();
  server.on("close", () => {
    clearInterval(reapTimer);
    clearInterval(pingTimer);
  });

  registerUpgradeRoute(server, {
    name: "pty",
    matches: (path) => PTY_PATH.test(path),
    handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on("error", (error) => {
        console.error("[pty] upgrade socket error:", error);
        socket.destroy();
      });
      void (async () => {
        try {
          const url = req.url ?? "";
          const path = url.split("?")[0];
          const m = PTY_PATH.exec(path);
          if (!m) { socket.destroy(); return; }

          const origin = req.headers.origin;
          const host = req.headers.host;
          const extraAllowed = (process.env.KUNPENG_WS_ALLOWED_ORIGINS ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
          const originDecision = isAllowedWsOrigin({ origin, host, extraAllowed });
          if (!originDecision.ok) {
            console.warn("[pty] 拒绝跨源 WebSocket 握手", { origin, host });
            rejectUpgrade(socket, "403 Forbidden");
            return;
          }
          if (originDecision.reason === "no-origin") {
            console.warn("[pty] 无 Origin 头的 WebSocket 握手（非浏览器客户端）", { host });
          }

          const authCfg = await readAuthConfig(opts.stateDir);
          let user: { accountId: string; profileId: string; username: string } | null = null;
          if (authCfg) {
            const cookies = parseCookies(req.headers.cookie);
            const session = cookies.kp_session
              ? verifySession(cookies.kp_session, authCfg.secret, now(), SESSION_MAX_AGE_MS)
              : null;
            const decision = session ? authorizeRequest(session, authCfg.accounts, path, resolveAuthzPolicy(), req.method) : null;
            if (!decision?.ok) {
              const explanation = session
                ? explainAuthzDenial(session, authCfg.accounts, path, resolveAuthzPolicy(), req.method)
                : { layer: "session", detail: "会话缺失、无效或已过期" };
              const { layer, detail } = explanation ?? {};
              console.warn("[pty] 鉴权拒绝", { path, layer, detail });
              rejectUpgrade(socket, "401 Unauthorized");
              return;
            }
            user = decision;
          } else {
            const trustedLocal = isTrustedLocalRequest({
              remoteAddress: req.socket.remoteAddress,
              forwardedFor: firstHeader(req.headers["x-forwarded-for"]),
              forwardedProto: firstHeader(req.headers["x-forwarded-proto"]),
            });
            if (!trustedLocal) {
              console.warn("[pty] 未启用鉴权且非本机直连，拒绝 WebSocket 握手", {
                remoteAddress: req.socket.remoteAddress,
                host: req.headers.host,
              });
              rejectUpgrade(socket, "403 Forbidden");
              return;
            }
          }

          const workspaceId = decodeURIComponent(m[1]);
          try {
            await authorizeWorkspaceInProfile(
              { accountId: user?.accountId, profileId: user?.profileId, username: user?.username },
              workspaceId,
              opts.resolveCwd,
            );
          } catch {
            rejectUpgrade(socket, "403 Forbidden");
            return;
          }
          const params = new URLSearchParams(url.split("?")[1] ?? "");
          const dims = clampPtyDims(params.get("cols"), params.get("rows"));
          const ctx: ConnCtx = {
            pool,
            workspaceId,
            accountId: user?.accountId,
            profileId: user?.profileId,
            username: user?.username,
            wantSession: params.get("session") ?? undefined,
            cols: dims.cols,
            rows: dims.rows,
            resolveCwd: opts.resolveCwd,
            revive: opts.revive,
            now,
          };
          wss.handleUpgrade(req, socket, head, (ws) => { void handleConnection(ws, ctx); });
        } catch {
          socket.destroy();
        }
      })();
    },
  });

  return pool;
}

export async function authorizeWorkspaceInProfile(
  ctx: { accountId?: string; profileId?: string; username?: string },
  workspaceId: string,
  resolveCwd: (id: string) => Promise<string>,
): Promise<string> {
  if (!ctx.accountId && !ctx.profileId && !ctx.username) return resolveCwd(workspaceId);
  return requestAuthContext.run(
    { accountId: ctx.accountId, profileId: ctx.profileId, username: ctx.username },
    () => resolveCwd(workspaceId),
  );
}

export async function handlePtyHttpRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  opts: { pool: PtySessionPool; resolveCwd: (wsId: string) => Promise<string> },
): Promise<boolean> {
  const path = url.split("?")[0];
  const m = PTY_SESSIONS_PATH.exec(path);
  if (!m) return false;

  const workspaceId = decodeURIComponent(m[1]);
  const sessionId = m[2] ? decodeURIComponent(m[2]) : undefined;
  res.setHeader("content-type", "application/json");

  try {
    if (method === "GET" && !sessionId) {
      try {
        await opts.resolveCwd(workspaceId);
      } catch {
        sendJson(res, 403, { ok: false, error: "无权访问该工作区的终端" });
        return true;
      }
      sendJson(res, 200, { ok: true, sessions: opts.pool.list(workspaceId) });
      return true;
    }

    if (method === "GET" && sessionId) {
      try {
        await opts.resolveCwd(workspaceId);
      } catch {
        sendJson(res, 403, { ok: false, error: "无权访问该工作区的终端" });
        return true;
      }
      const session = sessionForWorkspace(opts.pool, workspaceId, sessionId);
      if (!session) {
        sendJson(res, 404, { ok: false, error: `PTY session ${sessionId} not found` });
        return true;
      }
      sendJson(res, 200, { ok: true, session });
      return true;
    }

    if (method === "POST" && !sessionId) {
      const body = await readJsonBody(req);
      const dims = clampPtyDims(body.cols, body.rows);
      const session = opts.pool.create({
        workspaceId,
        cwd: await opts.resolveCwd(workspaceId),
        cols: dims.cols,
        rows: dims.rows,
      });
      sendJson(res, 201, { ok: true, session });
      return true;
    }

    if (method === "DELETE" && sessionId) {
      try {
        await opts.resolveCwd(workspaceId);
      } catch {
        sendJson(res, 403, { ok: false, error: "无权访问该工作区的终端" });
        return true;
      }
      const session = sessionForWorkspace(opts.pool, workspaceId, sessionId);
      if (!session) {
        sendJson(res, 404, { ok: false, error: `PTY session ${sessionId} not found` });
        return true;
      }
      try {
        opts.pool.kill(sessionId);
      } catch {
        // kill is best-effort after existence/workspace validation.
      }
      sendJson(res, 200, { ok: true, killed: sessionId });
      return true;
    }

    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return true;
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String((error as Error).message ?? error) });
    return true;
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function sessionForWorkspace(pool: PtySessionPool, workspaceId: string, sessionId: string): PtySessionInfo | undefined {
  const session = pool.get(sessionId);
  return session && session.workspaceId === workspaceId ? session : undefined;
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function closeWithError(ws: WebSocket, message: string): void {
  try {
    send(ws, { type: "error", message });
  } finally {
    try { ws.close(); } catch { /* 已关 */ }
  }
}

async function handleConnection(ws: WebSocket, ctx: ConnCtx): Promise<void> {
  ws.on("error", (error) => {
    console.error("[pty] WebSocket connection error:", error);
    try { ws.terminate(); } catch { /* 已关闭 */ }
  });
  let sessionId: string;
  let revived: boolean;
  try {
    const decision = await resolveSessionForConnection(
      { wantSession: ctx.wantSession, workspaceId: ctx.workspaceId },
      {
        aliveWorkspace: (id) => {
          const session = ctx.pool.get(id);
          return session?.alive ? session.workspaceId : undefined;
        },
        revive: ctx.revive,
      },
    );
    if (decision.mismatch) {
      closeWithError(ws, "会话不属于当前工作区");
      return;
    }

    // 复用/复活指定会话,或沿用现行逻辑新建。
    sessionId = decision.id ?? ctx.pool.create({
      workspaceId: ctx.workspaceId,
      cwd: await authorizeWorkspaceInProfile(
        { accountId: ctx.accountId, profileId: ctx.profileId, username: ctx.username },
        ctx.workspaceId,
        ctx.resolveCwd,
      ),
      cols: ctx.cols,
      rows: ctx.rows,
    }).id;
    revived = decision.id === undefined ? false : decision.revived;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    closeWithError(ws, `无法创建终端会话: ${reason}`);
    return;
  }
  send(ws, { type: "session", id: sessionId, workspaceId: ctx.workspaceId, revived });

  // 订阅:subscribe 内部先同步回放 scrollback,再续推新输出
  let paused = false;
  let drainTimer: ReturnType<typeof setInterval> | undefined;
  const clearDrainTimer = () => {
    if (!drainTimer) return;
    clearInterval(drainTimer);
    drainTimer = undefined;
  };
  const startDrainTimer = () => {
    if (drainTimer) return;
    drainTimer = setInterval(() => {
      if (backpressureDecision(ws.bufferedAmount, paused) !== "resume") return;
      try { ctx.pool.resume(sessionId); } catch { /* 会话已不存在 */ }
      paused = false;
      clearDrainTimer();
    }, 50);
    drainTimer.unref?.();
  };
  const unsub = ctx.pool.subscribe(sessionId, (data) => {
    send(ws, { type: "output", data });
    if (backpressureDecision(ws.bufferedAmount, paused) !== "pause") return;
    try { ctx.pool.pause(sessionId); } catch { /* 会话已不存在 */ }
    paused = true;
    startDrainTimer();
  });

  ws.on("message", (raw: unknown) => {
    let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === "input" && typeof msg.data === "string") {
      try { ctx.pool.write(sessionId, msg.data); } catch { /* 会话已不存在 */ }
    } else if (msg.type === "resize" && validTerminalSize(msg.cols) && validTerminalSize(msg.rows)) {
      try { ctx.pool.resize(sessionId, msg.cols as number, msg.rows as number); } catch { /* 会话已不存在 */ }
    }
  });

  const offExit = ctx.pool.onExit(sessionId, (code) => {
    send(ws, { type: "exit", code });
    try { ws.close(); } catch { /* 已关 */ }
  });

  ws.on("close", () => { unsub(); offExit(); clearDrainTimer(); }); // 只退订,会话留存供重连
}

function validTerminalSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 && value <= 1000;
}
