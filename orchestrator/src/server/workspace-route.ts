import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { WorkspaceDriver } from "../loop/workspace-driver.js";
import { kunpengStateDir } from "../project/state-dir.js";
import { accountHostCeiling, readAuthConfig } from "./auth.js";
import { escHtml, setSseHeaders, sseData, startSseHeartbeat } from "./chat-sse.js";
import {
  buildWorkspaceDriver,
  productionWorkspaceDeps,
} from "./workspace-driver-deps.js";
import { handleUpload } from "./upload-endpoints.js";
import { handleGate } from "./gate-endpoints.js";
import { type GateCardData } from "./chat-commands.js";
import { spawnStream } from "../agent/cli-stream.js";
import { requestAuthContext } from "./auth-context.js";
import { ConversationStore } from "../chat/conversation-store.js";
import { binEnv, resolveChatMode, streamChat, streamSay } from "./workspace-endpoints.js";
import { readJsonBody, readLimitedJsonBody, UPLOAD_MAX_BODY_BYTES } from "./read-body.js";
import { chatRunKey, getChatRun } from "./chat-run-bus.js";

// ── /命令:在工作区跑一条 shell 命令,流式回显(终端式) ──
export async function streamExec(
  _workspaceId: string, cmd: string, cwd: string,
  res: ServerResponse,
): Promise<void> {
  setSseHeaders(res);
  sseData(res, `<div class="kp-ev kp-ev-stage">$ ${escHtml(cmd)}</div>`);
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  const stopHeartbeat = startSseHeartbeat(res);
  try {
    const r = await spawnStream("bash", ["-lc", cmd], cwd, (line) => {
      sseData(res, `<span class="kp-ev-token">${escHtml(line)}\n</span>`);
    }, { timeoutMs: 120_000, env: binEnv(), signal: ac.signal });
    sseData(res, `<div class="kp-ev kp-ev-${r.exitCode === 0 ? "done" : "error"}">exit ${r.exitCode}</div>`);
  } catch (e: unknown) {
    sseData(res, `<div class="kp-ev kp-ev-error">出错:${escHtml(e instanceof Error ? e.message : String(e))}</div>`);
  } finally {
    stopHeartbeat();
  }
  res.write("event: end\ndata: {}\n\n");
  res.end();
}

let defaultDriver: WorkspaceDriver | undefined;

export interface WorkspaceRouteDeps {
  conversations?: ConversationStore;
  username?: string;
  /** 当前登录用户的会话 token,透传给 localfs MCP 子进程穿透鉴权门(无鉴权时空串)。 */
  localfsToken?: string;
  /** 测试/宿主可注入同源 gate 读取器，默认读取当前 profile 的真实状态。 */
  listGates?: () => Promise<GateCardData[]>;
  /** 把已授权 workspace id 解析为 agent 的实际启动目录。 */
  resolveCwd?: (workspaceId: string) => Promise<string | null>;
  /** 测试可注入 chat stream；生产默认使用真实 streamChat。 */
  streamChat?: typeof streamChat;
  /** 服务端判定请求来自非本机来源时，忽略客户端值并强制敏感。 */
  forceSensitive?: boolean;
}

export function isCsrfSafe(headers: Record<string, string | string[] | undefined>, host: string | undefined): boolean {
  const get = (k: string): string => {
    const v = headers[k];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const secMode = get("sec-fetch-mode").toLowerCase();
  if (secMode === "navigate") return false;
  const secSite = get("sec-fetch-site").toLowerCase();
  // 只认同源：same-site（兄弟子域）与 cross-site 一律拒；none 是用户直接发起（地址栏、书签）。
  if (secSite) return secSite === "same-origin" || secSite === "none";
  const hostOf = (u: string): string => {
    try {
      return new URL(u).host;
    } catch {
      return "";
    }
  };
  const origin = get("origin");
  if (origin) return hostOf(origin) === (host ?? "");
  const referer = get("referer");
  if (referer) return hostOf(referer) === (host ?? "");
  return true;
}

export function isExecAllowedForRole(role: string | undefined): boolean {
  return role !== "member";
}

export function isChatModeAllowedForRole(
  role: string | undefined,
  message: string,
  uiMode: string | undefined,
): boolean {
  if (role !== "member") return true;
  return resolveChatMode(message, uiMode).mode === "plan";
}

export async function handleWorkspaceRoute(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorkspaceRouteDeps = {},
): Promise<boolean> {
  const route = parseWorkspaceRoute(method, url);
  if (!route) return false;

  if (!isCsrfSafe(req.headers, req.headers.host)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "cross-site request refused" }));
    return true;
  }

  if (
    (route.kind === "say" || route.kind === "events" || route.kind === "gate") &&
    !isExecAllowedForRole(requestAuthContext.getStore()?.role)
  ) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `${route.kind} requires owner role` }));
    return true;
  }

  if (route.kind === "gate") {
    const result = await handleGate(getDefaultDriver(), route.workspaceId, await readJsonBody(req));
    writeJson(res, result);
    return true;
  }

  if (route.kind === "upload") {
    const parsed = await readLimitedJsonBody(req, UPLOAD_MAX_BODY_BYTES);
    if (!parsed.ok) {
      res.statusCode = 413;
      writeJson(res, { ok: false, error: "上传体过大" });
      return true;
    }
    const result = await handleUpload(parsed.body);
    writeJson(res, result);
    return true;
  }

  if (route.kind === "chatAttach") {
    const run = getChatRun(chatRunKey(deps.username ?? "local", route.conv ?? ""));
    if (!run) {
      res.statusCode = 204;
      res.end();
      return true;
    }
    const parsedAfter = Number(route.after);
    const after = Number.isFinite(parsedAfter) && parsedAfter >= 0 ? Math.floor(parsedAfter) : 0;
    setSseHeaders(res);
    const stopHeartbeat = startSseHeartbeat(res);
    const detach = run.subscribe(res, after);
    res.on("close", () => {
      detach();
      stopHeartbeat();
    });
    return true;
  }

  if (route.kind === "chatStop") {
    const run = getChatRun(chatRunKey(deps.username ?? "local", route.conv ?? ""));
    run?.abort();
    writeJson(res, { stopped: run !== undefined });
    return true;
  }

  if (route.kind === "chat") {
    const body = method === "POST" ? await readJsonBody(req) : {};
    const message = typeof body.message === "string" ? body.message : typeof body.msg === "string" ? body.msg : route.message ?? "";
    const model = typeof body.model === "string" ? body.model : route.model ?? "claude-opus-5";
    const images = typeof body.images === "string" ? body.images : route.images ?? "";
    const web = typeof body.web === "boolean" ? body.web : body.web === "1" ? true : route.web === "1";
    const conv = typeof body.conv === "string" ? body.conv : route.conv;
    const session = typeof body.session === "string" ? body.session : route.session;
    const mode = typeof body.mode === "string" ? body.mode : route.mode;
    const workMode = body.workMode === "trip" || body.workMode === "intranet" ? body.workMode : "full";
    const replaceLast = body.replaceLast === true;
    const sensitive = deps.forceSensitive === true
      ? true
      : typeof body.sensitive === "boolean" ? body.sensitive : undefined;
    const imageIds = images.split(",").filter(Boolean);
    const authContext = requestAuthContext.getStore();
    if (!isChatModeAllowedForRole(authContext?.role, message, mode)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "act mode requires owner role" }));
      return true;
    }
    // 同会话上一轮还在跑(刷新页面/别的设备再发)时不得静默接管掐掉它:409 让前端接回旧输出。
    if (conv) {
      const liveRun = getChatRun(chatRunKey(deps.username ?? "local", conv));
      if (liveRun && liveRun.done === false) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "chat run in progress", conv }));
        return true;
      }
    }
    const authConfig = authContext?.accountId
      ? await readAuthConfig(kunpengStateDir())
      : null;
    const account = authConfig?.accounts.find((candidate) => candidate.id === authContext?.accountId);
    const hostCeiling = authContext
      ? (account ? accountHostCeiling(account) : "isolated")
      : "full";

    let cwd: string | null;
    try {
      cwd = deps.resolveCwd ? await deps.resolveCwd(route.workspaceId) : null;
    } catch {
      cwd = null;
    }
    if (!cwd) {
      if (authContext) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "workspace is not authorized" }));
        return true;
      }
      cwd = process.cwd();
    }

    const chatStreamer = deps.streamChat ?? streamChat;
    await chatStreamer(session ?? conv ?? route.workspaceId, message, model, imageIds, web, cwd, res, {
      store: deps.conversations,
      username: deps.username,
      conv,
      session,
      projectId: route.workspaceId,
      accountId: authContext?.accountId,
      localfsToken: deps.localfsToken,
      listGates: deps.listGates,
      mode,
      workMode,
      hostCeiling,
      sensitive,
      ...(replaceLast ? { replaceLast: true } : {}),
    });
    return true;
  }

  if (route.kind === "exec") {
    if (!isExecAllowedForRole(requestAuthContext.getStore()?.role)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "exec requires owner role" }));
      return true;
    }
    await streamExec(route.workspaceId, route.message ?? "", process.cwd(), res);
    return true;
  }

  const message = route.message ?? await readMessageBody(req);
  await streamSay(getDefaultDriver(), route.workspaceId, message, res, route.model);
  return true;
}

type WorkspaceRoute = {
  kind: "events" | "say" | "gate" | "chat" | "chatAttach" | "chatStop" | "exec" | "upload";
  workspaceId: string;
  message?: string;
  model?: string;
  conv?: string;
  session?: string;
  images?: string;
  web?: string;
  mode?: string;
  after?: string;
};

export function parseWorkspaceRoute(
  method: string,
  rawUrl: string,
): WorkspaceRoute | undefined {
  const parsed = new URL(rawUrl, "http://localhost");
  const events = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/events$/);
  if (method === "GET" && events) {
    return {
      kind: "events",
      workspaceId: decodeURIComponent(events[1]),
      message: parsed.searchParams.get("msg") ?? parsed.searchParams.get("message") ?? "",
      model: parsed.searchParams.get("model") ?? undefined,
    };
  }

  const chatAttach = parsed.pathname.match(new RegExp("^/api/workspace/([^/]+)/chat/attach$"));
  if (method === "GET" && chatAttach) {
    return {
      kind: "chatAttach",
      workspaceId: decodeURIComponent(chatAttach[1]),
      conv: parsed.searchParams.get("conv") ?? undefined,
      after: parsed.searchParams.get("after") ?? undefined,
    };
  }

  const chatStop = parsed.pathname.match(new RegExp("^/api/workspace/([^/]+)/chat/stop$"));
  if (method === "POST" && chatStop) {
    return {
      kind: "chatStop",
      workspaceId: decodeURIComponent(chatStop[1]),
      conv: parsed.searchParams.get("conv") ?? undefined,
    };
  }

  const chat = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/chat$/);
  if ((method === "GET" || method === "POST") && chat) {
    return {
      kind: "chat",
      workspaceId: decodeURIComponent(chat[1]),
      message: parsed.searchParams.get("msg") ?? parsed.searchParams.get("message") ?? "",
      model: parsed.searchParams.get("model") ?? undefined,
      conv: parsed.searchParams.get("conv") ?? undefined,
      session: parsed.searchParams.get("session") ?? undefined,
      images: parsed.searchParams.get("images") ?? undefined,
      web: parsed.searchParams.get("web") ?? undefined,
      mode: parsed.searchParams.get("mode") ?? undefined,
    };
  }

  const upload = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/upload$/);
  if (method === "POST" && upload) {
    return { kind: "upload", workspaceId: decodeURIComponent(upload[1]) };
  }

  const exec = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/exec$/);
  if (method === "GET" && exec) {
    return {
      kind: "exec",
      workspaceId: decodeURIComponent(exec[1]),
      message: parsed.searchParams.get("cmd") ?? "",
    };
  }

  const say = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/say$/);
  if (method === "POST" && say) {
    return { kind: "say", workspaceId: decodeURIComponent(say[1]) };
  }

  const gate = parsed.pathname.match(/^\/api\/workspace\/([^/]+)\/gate$/);
  if (method === "POST" && gate) {
    return { kind: "gate", workspaceId: decodeURIComponent(gate[1]) };
  }

  return undefined;
}

async function readMessageBody(req: IncomingMessage): Promise<string> {
  const body = await readJsonBody(req);
  return String(body.message ?? body.msg ?? "");
}

function writeJson(res: ServerResponse, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function getDefaultDriver(): WorkspaceDriver {
  if (!defaultDriver) {
    const repoRoot = process.cwd();
    defaultDriver = buildWorkspaceDriver(productionWorkspaceDeps(
      async () => repoRoot,
      join(repoRoot, ".kunpeng"),
    ));
  }
  return defaultDriver;
}
