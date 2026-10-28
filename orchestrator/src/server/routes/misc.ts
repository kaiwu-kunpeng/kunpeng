import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { LoopStore } from "../../loop/store.js";
import { recipeRegistry, type WeakPoint } from "../../loop/recipe.js";
import { gitLogsForEscapeRate, buildEscapeRateFromLogs, rolledBackFlowIdsFromStates } from "../../metrics/escape-rate-report.js";
import { assertRegistrableRepo, kunpengStateDir, registerProject } from "../../project/registry.js";
import { writeDesignConfig } from "../../project/design-config.js";
import type { FlowTracker } from "../../runtime/flowstate.js";
import { addFeedback, readFeedback } from "../../runtime/review-feedback.js";
import { taskFromFlow } from "../../task/from-flow.js";
import { nextStatuses } from "../../task/model.js";
import { createTask, listTasks } from "../../task/store.js";
import { changePassword } from "../auth-change.js";
import { addAccount, deleteAccount, editAccount, listAccounts, readAuthConfig, writeAuthConfig } from "../auth.js";
import { requestAuthContext } from "../auth-context.js";
import { eventLoopLag } from "../event-loop-monitor.js";
import { listDir, serveFile } from "../file-serve.js";
import { collectHealthz } from "../healthz.js";
import { sendMaybeGzip } from "../http-compress.js";
import { perfHealthSnapshot } from "../perf-health.js";
import { gateProjects, resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { listFlowsCached } from "../state.js";
import { handleTaskCreate, handleTaskList, handleTaskTransition } from "../task-api.js";
import { todaySummary } from "../today.js";
import { clip, stripMd } from "../ui/fmt.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

async function defaultLoopWeakPoints(loopId: string, repoRoot: string): Promise<WeakPoint[]> {
  const store = new LoopStore(join(repoRoot, ".kunpeng", "loops"));
  const loop = await store.read(loopId);
  if (!loop) throw new Error(`loop 不存在: ${loopId}`);
  const recipe = recipeRegistry[loop.recipe];
  if (!recipe?.discoverWeakPoints) throw new Error(`recipe 无 discoverWeakPoints: ${loop.recipe}`);
  return recipe.discoverWeakPoints(loop, {});
}

const accountsHandle = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  context: RouteContext,
): Promise<void> => {
  const method = req.method ?? "GET";
  const stateDir = context.stateDir;
  res.setHeader("content-type", "application/json");
  const current = await readAuthConfig(stateDir);
  if (!current) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "未启用鉴权" }));
    return;
  }
  if (method === "GET") {
    res.end(JSON.stringify({ ok: true, accounts: listAccounts(current) }));
    return;
  }
  if (method === "POST") {
    try {
      const body = await readJsonBody(req);
      const next = addAccount(current, {
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
        profileId: String(body.profileId ?? "home"),
        role: body.role === "owner" ? "owner" : "member",
        hostCeiling: body.hostCeiling === "full" || body.hostCeiling === "readonly" || body.hostCeiling === "isolated" ? body.hostCeiling : undefined,
        salt: randomBytes(16).toString("hex"),
        now: Date.now(),
      });
      await writeAuthConfig(context.stateDir || kunpengStateDir(), next);
      res.end(JSON.stringify({ ok: true, accounts: listAccounts(next) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return;
  }
  if (method === "PATCH") {
    try {
      const body = await readJsonBody(req);
      const next = editAccount(current, {
        username: String(body.username ?? ""),
        newUsername: typeof body.newUsername === "string" ? body.newUsername : undefined,
        newPassword: typeof body.newPassword === "string" ? body.newPassword : undefined,
        profileId: typeof body.profileId === "string" ? body.profileId : undefined,
        role: body.role === "owner" || body.role === "member" ? body.role : undefined,
        hostCeiling: body.hostCeiling === "full" || body.hostCeiling === "readonly" || body.hostCeiling === "isolated" ? body.hostCeiling : undefined,
        salt: typeof body.newPassword === "string" ? randomBytes(16).toString("hex") : undefined,
        now: Date.now(),
      });
      await writeAuthConfig(context.stateDir || kunpengStateDir(), next);
      res.end(JSON.stringify({ ok: true, accounts: listAccounts(next) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return;
  }
  if (method === "DELETE") {
    try {
      const username = new URL(url, "http://x").searchParams.get("username") ?? "";
      if (username.trim() === requestAuthContext.getStore()?.username) {
        throw new Error("不能删除当前登录账号");
      }
      const next = deleteAccount(current, username);
      await writeAuthConfig(context.stateDir || kunpengStateDir(), next);
      res.end(JSON.stringify({ ok: true, accounts: listAccounts(next) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return;
  }
};

registerModularRoute({ method: "GET", path: "/api/accounts", handle: accountsHandle });
registerModularRoute({ method: "POST", path: "/api/accounts", handle: accountsHandle });
registerModularRoute({ method: "PATCH", path: "/api/accounts", handle: accountsHandle });
registerModularRoute({ method: "DELETE", path: "/api/accounts", handle: accountsHandle });

registerModularRoute({
  method: "GET",
  path: "/healthz",
  handle: async (_req, res) => {
    const report = await collectHealthz({ stateDir: kunpengStateDir() });
    res.statusCode = report.ok ? 200 : 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(report));
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/perf-health",
  handle: async (_req, res) => {
    res.setHeader("content-type", "application/json");
    const lag = eventLoopLag();
    res.end(JSON.stringify(perfHealthSnapshot({ eventLoopDelayMs: lag.p99Ms })));
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/today",
  handle: async (req, res, url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
      return;
    }
    const flows = await listFlowsCached(repoRoot);
    const windowHoursRaw = q.get("windowHours");
    const windowHours = windowHoursRaw === null ? 24 : Number(windowHoursRaw);
    const windowMs = windowHours === 0 ? undefined : windowHours * 3_600_000;
    const flowTasks = flows.map((flow) => {
      const task = taskFromFlow({
        flowId: flow.flowId,
        requirement: flow.requirement,
        stage: flow.stage,
        status: flow.status,
        gate: flow.humanGate?.gate ?? null,
        updatedAt: flow.updatedAt,
      });
      return {
        ...task,
        title: clip(stripMd(flow.requirement ?? task.title ?? flow.flowId ?? ""), 80),
        source: "flow" as const,
      };
    });
    const tasks = await listTasks(repoRoot);
    const taskEntries = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      source: "store" as const,
      nextStatuses: nextStatuses(task.status),
      acceptanceCriteria: task.acceptanceCriteria,
      updatedAt: Date.parse(task.updatedAt),
    }));
    await sendMaybeGzip(req, res, JSON.stringify(todaySummary({ tasks: [...flowTasks, ...taskEntries], windowMs })), "application/json; charset=utf-8");
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/tasks/transition",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
      return;
    }
    const result = await handleTaskTransition(body, repoRoot);
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
    return;
  },
});

const tasksHandle = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  context: RouteContext,
): Promise<void> => {
  const method = req.method ?? "GET";
  res.setHeader("content-type", "application/json");
  const q = new URL(url, "http://x").searchParams;
  const body = method === "POST" ? await readJsonBody(req) : {};
  const projectId = method === "POST" ? String(body.projectId ?? "") : String(q.get("projectId") ?? "");
  const repoRoot = await resolveRepo(context, projectId);
  if (!repoRoot) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
    return;
  }
  if (method === "POST") {
    const result = await handleTaskCreate(body, repoRoot);
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
    return;
  }
  if (method === "GET") {
    const result = await handleTaskList(repoRoot);
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
    return;
  }
};

registerModularRoute({ method: "GET", path: "/api/tasks", handle: tasksHandle });
registerModularRoute({ method: "POST", path: "/api/tasks", handle: tasksHandle });

registerModularRoute({
  method: "GET",
  path: "/api/escape-rate",
  handle: async (_req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const WINDOW_7D = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const projects: { name: string; rate: number; mergedCount: number; escapedCount: number; rate7d: number; merged7d: number; escaped7d: number; escapedFlowIds: string[] }[] = [];
      let totMerged = 0, totEscaped = 0, tot7dMerged = 0, tot7dEscaped = 0;
      for (const repo of await gateProjects(context)) {
        let states: Awaited<ReturnType<FlowTracker["list"]>> = [];
        try {
          states = await listFlowsCached(repo);
        } catch {
          states = [];
        }
        const rolledBack = rolledBackFlowIdsFromStates(states.map((s) => ({ flowId: s.flowId, status: s.status })));
        const { mergedLog, revertLog } = await gitLogsForEscapeRate(repo);
        const all = buildEscapeRateFromLogs(mergedLog, revertLog, rolledBack);
        const w7 = buildEscapeRateFromLogs(mergedLog, revertLog, rolledBack, { windowMs: WINDOW_7D, now });
        const name = repo.split("/").filter(Boolean).pop() ?? repo;
        projects.push({ name, rate: all.rate, mergedCount: all.mergedCount, escapedCount: all.escapedCount, rate7d: w7.rate, merged7d: w7.mergedCount, escaped7d: w7.escapedCount, escapedFlowIds: all.escapedFlowIds.slice(0, 8) });
        totMerged += all.mergedCount; totEscaped += all.escapedCount; tot7dMerged += w7.mergedCount; tot7dEscaped += w7.escapedCount;
      }
      const total = { mergedCount: totMerged, escapedCount: totEscaped, rate: totMerged > 0 ? totEscaped / totMerged : 0 };
      const total7d = { mergedCount: tot7dMerged, escapedCount: tot7dEscaped, rate: tot7dMerged > 0 ? tot7dEscaped / tot7dMerged : 0 };
      res.end(JSON.stringify({ ok: true, total, total7d, projects }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/feedback",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const repoRoot = await resolveRepo(context, String(body.projectId ?? ""));
      const flowId = String(body.flowId ?? "");
      const comment = String(body.comment ?? "").trim();
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${body.projectId}` })); return; }
      if (!flowId || !comment) { res.end(JSON.stringify({ ok: false, error: "缺 flowId 或 comment" })); return; }
      await addFeedback(repoRoot, flowId, { comment, ...(body.file ? { file: String(body.file) } : {}), ...(Number.isFinite(body.line) ? { line: Number(body.line) } : {}) });
      const all = await readFeedback(repoRoot, flowId);
      res.end(JSON.stringify({ ok: true, count: all.length, note: `已记审查意见(${all.length} 条)；resume 时会注入重做` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/register-project",
  handle: async (req, res) => {
    const reqBody = await readJsonBody(req);
    const repoPath = String(reqBody.repoPath ?? "");
    const name = String(reqBody.name ?? "");
    res.setHeader("content-type", "application/json");
    const check = await assertRegistrableRepo(repoPath);
    if (!check.ok) {
      res.end(JSON.stringify({ ok: false, error: check.error }));
      return;
    }
    try {
      const entry = await registerProject({
        repoPath,
        name: name || undefined,
        now: Date.now(),
        stateDir: kunpengStateDir(),
      });
      res.end(JSON.stringify({ ok: true, entry: { id: entry.id, name: entry.name } }));
    } catch {
      res.end(JSON.stringify({ ok: false, error: "注册失败" }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/auth/change-password",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const b = await readJsonBody(req);
    const r = await changePassword(context.stateDir || kunpengStateDir(), {
      username: requestAuthContext.getStore()?.username,
      currentPassword: String(b.currentPassword ?? ""),
      newPassword: String(b.newPassword ?? ""),
    }, {
      salt: randomBytes(16).toString("hex"),
      now: Date.now(),
    });
    res.end(JSON.stringify(r));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/loop-weakpoints",
  handle: async (req, res, _url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const loopId = String(body.loopId ?? "").trim();
    res.setHeader("content-type", "application/json");
    if (!loopId) { res.end(JSON.stringify({ ok: false, error: "缺 loopId" })); return; }
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const weakPoints = await (context.loopWeakPoints ?? defaultLoopWeakPoints)(loopId, repoRoot);
      res.end(JSON.stringify({ ok: true, weakPoints }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/loop-lever-to-task",
  handle: async (req, res, _url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const loopId = String(body.loopId ?? "").trim();
    const leverId = String(body.leverId ?? "").trim();
    const leverLabel = String(body.leverLabel ?? leverId).trim();
    res.setHeader("content-type", "application/json");
    if (!loopId) { res.end(JSON.stringify({ ok: false, error: "缺 loopId" })); return; }
    if (!leverId) { res.end(JSON.stringify({ ok: false, error: "缺 leverId" })); return; }
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    const nowIso = new Date().toISOString();
    try {
      const task = await createTask(repoRoot, {
        id: `task-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
        title: `实现运营杠杆：${leverLabel || leverId}`,
        type: "ops-dev",
        projectId,
        status: "ready",
        createdAt: nowIso,
        updatedAt: nowIso,
        goal: `将 loop ${loopId} 的 needs-dev 杠杆 ${leverId} 落成可执行开发任务。`,
        context: `来源：运营工作台 needs-dev 杠杆转任务；loop=${loopId}；lever=${leverId}。`,
        acceptanceCriteria: [
          "任务实现后对应运营杠杆不再停留在 needs-dev。",
          "实现必须走项目既有验证命令并留下真实输出。",
        ],
      });
      res.end(JSON.stringify({ ok: true, taskId: task.id }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/file",
  handle: async (_req, res, url) => {
    const q = new URL(url, "http://x").searchParams;
    await serveFile(res, process.cwd(), q.get("path") ?? "", q.get("disp") ?? undefined);
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/files",
  handle: async (_req, res, url) => {
    const q = new URL(url, "http://x").searchParams;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(await listDir(process.cwd(), q.get("dir") ?? ".")));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/select-design",
  handle: async (req, res, _url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const source = String(body.source ?? "");
    const anchor = String(body.anchor ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      await writeDesignConfig(repoRoot, { source, anchor });
      res.end(JSON.stringify({ ok: true, note: `已选定设计 ${source}，保存进 project.json` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
