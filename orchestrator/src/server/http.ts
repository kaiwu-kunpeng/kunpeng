import { execFile } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { WeakPoint } from "../loop/recipe.js";
import { kunpengStateDir } from "../project/registry.js";
import { capLogFile } from "../runtime/log-cap.js";
import { writeServeHeartbeat } from "../status/serve-heartbeat.js";
import { renderShell } from "./ui/shell.js";
import { sendMaybeGzip } from "./http-compress.js";
import { applySecurityHeaders } from "./security-headers.js";
import type { SpawnFn } from "./launch.js";
import { readAuthConfig, decideAuth, isTrustedLocalRequest, signSession, SESSION_MAX_AGE_MS } from "./auth.js";
import { handleAuthAction } from "./auth-flow.js";
import { appendAudit, isAuditableApiWrite } from "./audit.js";
import { buildAuthGate } from "./profile-middleware.js";
import { runMigration } from "./profile-migrate-exec.js";
import { gcUploads, handleWorkspaceRoute, isCsrfSafe, UPLOAD_DIR } from "./workspace-endpoints.js";
import type { WorkspaceRouteDeps } from "./workspace-route.js";
import { handleConversationAction } from "./conversation-endpoints.js";
import { createPeerMessagesReader } from "../chat/peer-timeline.js";
import { SwitchboardStore } from "../switchboard/store.js";
import { resolveIdentity } from "../switchboard/identity.js";
import { defaultPresenceBeater, startPresenceHeartbeat } from "../switchboard/presence-heartbeat.js";
import { attachPtyWebSocket, handlePtyHttpRoute } from "./pty-endpoint.js";
import { handleSwitchboardRoute } from "./routes/switchboard.js";
import { attachWorkerWebSocket } from "./worker/worker-endpoint.js";
import { setWorkerEndpoint } from "./worker/worker-runtime.js";
import { PtySessionPool } from "./pty-pool.js";
import { nodePtyFactory } from "./pty-node-factory.js";
import { sweepPtyOrphans } from "./pty-orphan.js";
import { readPtyRegistry } from "./pty-registry.js";
import { ptyRegistryHooks } from "./pty-registry-hooks.js";
import { findTmuxBin, resolveReviveDecision, tmuxHasSessionArgs, tmuxSessionName } from "./pty-tmux.js";
import { tmuxPtyFactory } from "./pty-tmux-factory.js";
import { currentConversationOwner, currentProfileId, currentUsername, requestAuthContext } from "./auth-context.js";
import { resolveRepo } from "./project-scope.js";
import { dashboardProjects } from "./snapshots.js";
import { createAuthzRegistry } from "./localfs/authz-registry.js";
import { createOpQueue } from "./localfs/op-queue.js";
import { handleLocalFsHttpRoute } from "./localfs/http-route.js";
import { serveBeacon, serveBeaconIngest, servePwaStatic, serveVendorStatic } from "./beacon-static.js";
import {
  captureConversationSearches,
  conversationStore,
  migrateLegacyConversationOwners,
  parseConversationRoute,
} from "./conversation-glue.js";
import { dispatchModularRoute } from "./routes/registry.js";
import { handlePreviewsRoute } from "./routes/views.js";
import { collectOverviewState, docsDir, repoProjectName } from "./view-state.js";
import { tryServePublicReport } from "./public-reports.js";
import "./routes/plugins-page.js";
import "./routes/attention.js";
import "./routes/control-plane-audit.js";
import "./routes/vendor-pdfjs.js";
import "./routes/gate-actions.js";
import "./routes/gate-comments.js";
import "./routes/gates.js";
import "./routes/help.js";
import "./routes/inbox.js";
import "./routes/knowledge.js";
import "./routes/library.js";
import "./routes/misc.js";
import "./routes/ops-actions.js";
import "./routes/overview.js";
import "./routes/product-define.js";
import "./routes/product-build.js";
import "./routes/product-preview.js";
import "./routes/product-workspace.js";
import "./routes/push.js";
import "./routes/run-control.js";
import "./routes/plans.js";
import "./routes/settings.js";
import "./routes/solutions-ops.js";
import "./routes/taskboard.js";
import "./routes/version.js";
import "./routes/design.js";
import "./routes/worker.js";
import { ensureVapidKeys, startGateWatch } from "./push.js";
import { handleWebhookHttpRoute } from "./webhook-endpoints.js";

const execFileAsync = promisify(execFile);

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

import { readJsonBody, readLimitedJsonBody } from "./read-body.js";
export { readJsonBody, readLimitedJsonBody };

export interface DashboardOpts {
  port: number;
  stateDir?: string;
  presenceIntervalMs?: number;
  repoRoot?: string;
  execPath?: string;
  cliJs?: string;
  host?: string;
  spawn?: SpawnFn;
  ptyPool?: PtySessionPool;
  loopWeakPoints?: (loopId: string, repoRoot: string) => Promise<WeakPoint[]>;
  /** 测试/宿主可注入 chat stream；生产缺省使用 workspace route 的真实实现。 */
  streamChat?: NonNullable<WorkspaceRouteDeps["streamChat"]>;
  /** 起服务时清扫 kp-pty-* 孤儿 tmux 会话。只有真正的 `kunpeng serve` 入口才开；测试 / 第二实例缺省关，
   *  绝不碰宿主机上别的实例正在用的终端（曾因 HOME 指到临时目录、登记表为空而把活终端全杀）。 */
  sweepPtyOrphans?: boolean;
}

export function httpErrorView(err: unknown, opts: { debug: boolean }): { message: string } {
  return { message: opts.debug ? String(err) : "内部错误" };
}

export async function startDashboard(opts: DashboardOpts): Promise<{ port: number; address?: string; close: () => Promise<void> }> {
  const resolvedStateDir = opts.stateDir || kunpengStateDir();
  await ensureVapidKeys(resolvedStateDir);
  const conversations = conversationStore(opts);
  await migrateLegacyConversationOwners(resolvedStateDir, conversations);
  const stopGateWatch = startGateWatch(60000);
  let dashboardClosed = false;
  return new Promise((resolve, reject) => {
    let migrationError: Error | undefined;
    const ptyRegistryPath = join(os.homedir(), ".kunpeng", "pty-registry.json");
    const tmuxBin = findTmuxBin(existsSync, process.env.PATH);
    const ptyTmuxTtlMs = Number(process.env.KUNPENG_PTY_TMUX_TTL_MS);
    const ptyFactory = tmuxBin ? tmuxPtyFactory(tmuxBin) : nodePtyFactory;
    const ptyPool = opts.ptyPool ?? new PtySessionPool({
      factory: ptyFactory,
      ...ptyRegistryHooks(ptyRegistryPath),
    });
    if (tmuxBin && opts.sweepPtyOrphans === true) void sweepPtyOrphans({
      tmuxBin,
      registryPath: ptyRegistryPath,
      ...(Number.isFinite(ptyTmuxTtlMs) && ptyTmuxTtlMs > 0 ? { ttlMs: ptyTmuxTtlMs } : {}),
    }).catch(() => {});
    const localFsAuthz = createAuthzRegistry(500, process.env.KP_LOCALFS_STRICT_OWNER === "1", join(opts.stateDir || kunpengStateDir(), "localfs-authz.json"));
    const localFsQueue = createOpQueue({ hasAuthz: (conv) => Boolean(localFsAuthz.get(conv)) });
    const resolveWorkspaceCwd = async (workspaceId: string) => {
      const repo = await resolveRepo(opts, workspaceId);
      if (!repo) throw new Error(`未知工作区 ${workspaceId}`);
      return repo;
    };
    const revivePtySession = tmuxBin
      ? async (id: string, workspaceId: string): Promise<boolean> => {
        try {
          const registry = await readPtyRegistry(ptyRegistryPath);
          const registryEntry = registry[id];
          let tmuxHasSession = false;
          try {
            await execFileAsync(tmuxBin, tmuxHasSessionArgs(tmuxSessionName(id)));
            tmuxHasSession = true;
          } catch {
            tmuxHasSession = false;
          }

          const decision = resolveReviveDecision({
            poolHasAlive: ptyPool.get(id)?.alive === true,
            registryEntry,
            tmuxHasSession,
            workspaceId,
          });
          if (decision !== "revive" || !registryEntry) return false;
          ptyPool.create({ id, workspaceId, cwd: registryEntry.cwd });
          return true;
        } catch {
          return false;
        }
      }
      : undefined;
    void runMigration(opts.stateDir || kunpengStateDir()).catch((error: unknown) => {
      migrationError = error instanceof Error ? error : new Error(String(error));
    });
    const server = createServer(async (req, res) => {
      applySecurityHeaders(req, res);
      const debug = process.env.KUNPENG_ALLOW_INSECURE === "1" || process.env.NODE_ENV === "development";
      try {
        if (migrationError) {
          res.statusCode = 500;
          res.end(`profile migration failed: ${migrationError.message}`);
          return;
        }
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        const path = url.split("?")[0];
        const stateDir = opts.stateDir || kunpengStateDir();
        const remoteIsLoopback = isTrustedLocalRequest({
          remoteAddress: req.socket.remoteAddress,
          forwardedFor: firstHeader(req.headers["x-forwarded-for"]),
          forwardedProto: firstHeader(req.headers["x-forwarded-proto"]),
        });

        if (await handleWebhookHttpRoute(method, path, url, req, res, { stateDir, remoteIsLoopback })) return;

        if (servePwaStatic(method, path, res)) return;
        if (await serveVendorStatic(req, method, path, res)) return;
        if (await serveBeacon(opts, method, path, url, req, res)) return;
        if (await serveBeaconIngest(opts, method, path, req, res)) return;

        // ── 鉴权中间件: auth.json 存在才启用(否则向后兼容现有 localhost 用法) ──
        if (await tryServePublicReport(req, res, { stateDir, docsDir: docsDir(), path })) return;
        const authCfg = await readAuthConfig(stateDir);
        const action = decideAuth({
          authEnabled: !!authCfg,
          path,
          method,
          cookieHeader: req.headers.cookie,
          secret: authCfg?.secret ?? "",
          now: Date.now(),
          maxAgeMs: SESSION_MAX_AGE_MS,
          remoteIsLoopback,
        });
        if (await handleAuthAction(action, req, res, { stateDir, authCfg })) return;
        if (authCfg && action === "allow") {
          const gate = await buildAuthGate({
            stateDir,
            now: Date.now,
            maxAgeMs: SESSION_MAX_AGE_MS,
          })(req, res, path);
          if (!gate.ok) return;
          requestAuthContext.enterWith({ accountId: gate.accountId, username: gate.username, profileId: gate.profileId, role: gate.role });
        }
        // action === "allow" -> 继续往下走原有路由
        // 写接口统一来源校验（防 CSRF）：兄弟子域与驾驶舱同站，SameSite=Lax 挡不住。
        // webhook、beacon、登录/登出在上面已处理完，/kpworker 不在 /api 下，都不受影响。
        if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method) && !isCsrfSafe(req.headers, req.headers.host)) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "cross-site request refused" }));
          return;
        }
        if (isAuditableApiWrite(method, path)) {
          void appendAudit(stateDir, { at: Date.now(), action: "api-write", user: currentUsername(), path });
        }

        if (await dispatchModularRoute(method, url, req, res, { repoRoot: opts.repoRoot, stateDir, execPath: opts.execPath, cliJs: opts.cliJs, spawn: opts.spawn, loopWeakPoints: opts.loopWeakPoints })) return;

        if (await handlePtyHttpRoute(method, url, req, res, { pool: ptyPool, resolveCwd: resolveWorkspaceCwd })) return;

        if (await handleLocalFsHttpRoute(method, url, req, res, localFsQueue, localFsAuthz)) return;

        // localfs MCP 子进程没有自己的会话,给它签一份当前用户的 token,enqueue 时当 cookie 用,
        // 才能穿透 decideAuth 鉴权门(无鉴权时 authCfg 为空 → token 为空串,向后兼容)。
        const localfsToken = authCfg
          ? signSession(currentConversationOwner(), currentProfileId() ?? "home", authCfg.secret, Date.now())
          : "";
        if (await handleWorkspaceRoute(method, url, req, res, {
          conversations,
          username: currentConversationOwner(),
          localfsToken,
          resolveCwd: resolveWorkspaceCwd,
          forceSensitive: !remoteIsLoopback,
          streamChat: opts.streamChat,
        })) return;

        const conversationRoute = parseConversationRoute(url);
        if (conversationRoute) {
          res.setHeader("content-type", "application/json");
          try {
            const body = method === "GET"
              ? { archived: ["1", "true"].includes(new URL(url, "http://x").searchParams.get("archived") ?? ""), q: new URL(url, "http://x").searchParams.get("q") ?? undefined }
              : await readJsonBody(req);
            const action = await handleConversationAction(
              conversationRoute.restore ? "POST" : method,
              conversationRoute.id,
              body,
              {
                store: conversations,
                username: currentConversationOwner(),
                captureSearched: (conversation) => captureConversationSearches(opts, conversation),
                peerMessages: createPeerMessagesReader({
                  self: resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: opts.repoRoot ?? process.cwd() }),
                  username: currentConversationOwner(),
                  inbox: (to) => new SwitchboardStore(join(stateDir, "switchboard")).inbox(to),
                  activity: (user) => conversations.listTurnActivity(user),
                }),
              },
            );
            res.statusCode = action.status;
            res.end(JSON.stringify(action.json ?? { ok: true }));
          } catch (e) {
            console.error("[http] conversation request failed", e);
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: httpErrorView(e, { debug }).message }));
          }
          return;
        }

        if (await handleSwitchboardRoute(method, url, req, res, { stateDir: opts.stateDir || kunpengStateDir() })) return;

        // 缺陷逃逸率：合并后被 git-revert 或 FlowState rolled-back 的占比，量化合并门/accept 的真实拦截力。
        // 按需计算（不进 collectState 热轮询路径），跨项目逐个 git log + FlowState。
        // #6 diff 内联回灌:cockpit 提交审查意见(可带 file/line)→存到流的 feedback,resume 时注入 implement 重做。
        if (await handlePreviewsRoute(method, url, res, opts)) return;

        if (method === "GET" && path === "/") {
          const projectName = opts.repoRoot ? repoProjectName(opts.repoRoot) : undefined;
          const projects = await dashboardProjects(opts);
          // SPA 壳必须每次重新校验,否则浏览器启发式缓存旧壳(内联含 clientScript)→ 前端改了"没生效/又不见"。
          res.setHeader("cache-control", "no-cache");
          await sendMaybeGzip(
            req,
            res,
            renderShell(await collectOverviewState(opts), {
              projectName,
              projectId: projectName,
              projects,
              ...(authCfg ? { username: currentUsername() } : {}),
            }),
            "text/html; charset=utf-8",
          );
          return;
        }

        res.statusCode = 404;
        res.end("not found");
      } catch (e) {
        console.error("[http] request failed", e);
        res.statusCode = 500;
        res.end(httpErrorView(e, { debug }).message);
      }
    });
    // 远程工作台第二期:PTY 常驻 shell 会话池(WebSocket)。/api/workspace/:id/pty
    attachPtyWebSocket(server, {
      stateDir: opts.stateDir || kunpengStateDir(),
      resolveCwd: resolveWorkspaceCwd,
      pool: ptyPool,
      ...(revivePtySession ? { revive: revivePtySession } : {}),
    });
    // 异地工作机通道(出差模式):/api/worker/connect
    const workerEndpoint = attachWorkerWebSocket(server, {
      resolveSecret: async () => (await readAuthConfig(opts.stateDir || kunpengStateDir()))?.secret ?? null,
    });
    setWorkerEndpoint(workerEndpoint);
    void gcUploads(UPLOAD_DIR, 7 * 24 * 60 * 60 * 1000, Date.now).catch(() => {});
    server.listen(opts.port, opts.host ?? "127.0.0.1", async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : opts.port;
        const address = typeof addr === "object" && addr ? addr.address : undefined;
        const presenceHeartbeat = startPresenceHeartbeat({
          presence: defaultPresenceBeater(resolvedStateDir),
          instance: resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: process.cwd() }),
          meta: { worktree: process.cwd(), task: `kunpeng serve ${port}` },
          ...(opts.presenceIntervalMs !== undefined ? { intervalMs: opts.presenceIntervalMs } : {}),
        });
        const refreshServeHeartbeat = async (): Promise<void> => {
          if (dashboardClosed) return;
          try {
            await writeServeHeartbeat(opts.stateDir || kunpengStateDir(), { ts: Date.now(), port, pid: process.pid });
          } catch (error) {
            if (dashboardClosed) return;
            console.error(`[serve-heartbeat] write failed: ${String((error as Error).message ?? error)}`);
          }
        };
        await refreshServeHeartbeat();
        const heartbeatTimer = setInterval(refreshServeHeartbeat, 30_000);
        heartbeatTimer.unref?.();
        server.on("close", () => clearInterval(heartbeatTimer));
        try {
          const serveLogPath = process.env.KUNPENG_SERVE_LOG;
          if (serveLogPath) {
            const capServeLog = (): void => {
              try {
                capLogFile(serveLogPath, {
                  maxBytes: 64 * 1024 * 1024,
                  keepBytes: 8 * 1024 * 1024,
                });
              } catch (error) {
                console.error(`[log-cap] check failed: ${String((error as Error).message ?? error)}`);
              }
            };
            capServeLog();
            const logCapTimer = setInterval(capServeLog, 300_000);
            logCapTimer.unref?.();
            server.on("close", () => clearInterval(logCapTimer));
          }
        } catch (error) {
          console.error(`[log-cap] setup failed: ${String((error as Error).message ?? error)}`);
        }
        resolve({
          port,
          address,
          close: async () => {
            dashboardClosed = true;
            const stopped = stopGateWatch();
            const presenceStopped = presenceHeartbeat.stop();
            setWorkerEndpoint(null);
            workerEndpoint.close();
            server.close();
            await stopped;
            await presenceStopped;
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
