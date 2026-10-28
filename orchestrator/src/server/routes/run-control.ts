import os from "node:os";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join, resolve as pathResolve, sep } from "node:path";
import { ArtifactStore } from "../../artifacts/store.js";
import { extractAuthorFilesFromSpec } from "../../loop/dev-cycle.js";
import { extractAcceptance } from "../../plan/acceptance.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { abandonFlow } from "../../runtime/flow-abandon.js";
import { FlowTracker } from "../../runtime/flowstate.js";
import { clearPause, requestPause } from "../../runtime/pause-marker.js";
import { accountHostCeiling, readAuthConfig } from "../auth.js";
import { requestAuthContext } from "../auth-context.js";
import { launchKunpeng, loopRunArgs, planArgs, resumeArgs, runArgs } from "../launch.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

/** 文本里是否自带验收命令（accept 块 / 验收: 行）或锁定验收文件块——两者都会在宿主上被执行。 */
function carriesCustomAccept(text: string): boolean {
  return extractAcceptance(text) !== null || extractAuthorFilesFromSpec(text).length > 0;
}

/** 自带验收命令只许 owner 且宿主上限为 full（两者取更严）；未启用登录（本机）不拦。返回拒绝原因，放行返回 null。 */
async function customAcceptDenial(context: RouteContext): Promise<string | null> {
  const auth = requestAuthContext.getStore();
  if (!auth) return null;
  const reason = "自带验收命令（acceptanceCmd / accept 块 / 锁定验收文件）会在宿主上执行，只有宿主上限为 full 的 owner 可以提交；请改用仓里已有 spec 的验收";
  if (auth.role !== "owner") return reason;
  const cfg = await readAuthConfig(context.stateDir);
  const account = cfg?.accounts.find((candidate) => candidate.id === auth.accountId);
  return accountHostCeiling(account) === "full" ? null : reason;
}

function refuse(res: ServerResponse, error: string): void {
  res.statusCode = 403;
  res.end(JSON.stringify({ ok: false, error }));
}

registerModularRoute({
  method: "POST",
  path: "/api/abandon-flow",
  handle: async (req, res, url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const projectId = String(body.projectId ?? "");
      const flowId = String(body.flowId ?? "");
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) {
        res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
        return;
      }
      const result = await abandonFlow(resolveProjectStateDir(repoRoot), flowId);
      res.end(JSON.stringify(result.ok ? { ok: true, note: `已中止流 ${flowId}` } : result));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

// S2 切片6 cockpit pause:写 pause 标记,运行中的流在下个阶段边界(checkpoint 已存)优雅停。
registerModularRoute({
  method: "POST",
  path: "/api/pause",
  handle: async (req, res, url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const repoRoot = await resolveRepo(context, String(body.projectId ?? ""));
      const flowId = String(body.flowId ?? "");
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${body.projectId}` })); return; }
      if (!flowId) { res.end(JSON.stringify({ ok: false, error: "缺 flowId" })); return; }
      await requestPause(repoRoot, flowId);
      res.end(JSON.stringify({ ok: true, note: `已请求暂停 ${flowId}：将在下个阶段边界停下，可恢复` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

// cockpit resume:清 pause 标记 + spawn `kunpeng resume <flowId>` 从 checkpoint 续跑。
registerModularRoute({
  method: "POST",
  path: "/api/resume",
  handle: async (req, res, url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const repoRoot = await resolveRepo(context, String(body.projectId ?? ""));
      const flowId = String(body.flowId ?? "");
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${body.projectId}` })); return; }
      if (!flowId) { res.end(JSON.stringify({ ok: false, error: "缺 flowId" })); return; }
      if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
      await clearPause(repoRoot, flowId);
      const { pid, logPath } = launchKunpeng({ execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn }, resumeArgs(flowId, repoRoot), repoRoot);
      res.end(JSON.stringify({ ok: true, pid, logPath, note: `已从 checkpoint 续跑 ${flowId}` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/run",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const requirement = String(body.requirement ?? "");
    const acceptanceCmd = typeof body.acceptanceCmd === "string" ? body.acceptanceCmd : undefined;
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (acceptanceCmd?.trim() || carriesCustomAccept(requirement)) {
      const denial = await customAcceptDenial(context);
      if (denial) { refuse(res, denial); return; }
    }
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        runArgs(requirement, repoRoot, acceptanceCmd),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, note: "已启动流，进度见「运行中的流」" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/loop-run",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const loopId = String(body.loopId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!loopId.trim()) { res.end(JSON.stringify({ ok: false, error: "缺 loopId" })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        loopRunArgs(loopId, repoRoot),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, note: `已启动 loop ${loopId} 一轮 wave，进度见 flow 日志` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/plan",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const planPath = typeof body.planPath === "string" ? body.planPath : "";
    const inlineMd = typeof body.inlineMd === "string" ? body.inlineMd : "";
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    if (carriesCustomAccept(inlineMd)) {
      const denial = await customAcceptDenial(context);
      if (denial) { refuse(res, denial); return; }
    }
    if (!planPath.trim() && !inlineMd.trim()) { res.end(JSON.stringify({ ok: false, error: "planPath 或 inlineMd 不能为空" })); return; }
    try {
      let planRef: string;
      let planFile: string | undefined;
      if (inlineMd.trim()) {
        const dir = join(repoRoot, ".kunpeng", "cockpit");
        await mkdir(dir, { recursive: true });
        // HIGH-1：文件名带随机段，绝不靠时间戳——同毫秒并发会撞名覆盖、让方案静默丢失/跑错内容。
        planFile = join(dir, `plan-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.md`);
        await writeFile(planFile, inlineMd, "utf8");
        planRef = planFile;
      } else {
        // MED-1：planPath 防穿越——必须落在 repoRoot 内（与 /previews 用 basename 同等的安全姿态），否则拒绝、绝不 spawn。
        const resolved = pathResolve(repoRoot, planPath);
        if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
          res.end(JSON.stringify({ ok: false, error: "planPath 越界（须在项目目录内）" })); return;
        }
        planRef = resolved;
      }
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        planArgs(planRef, repoRoot),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, ...(planFile ? { planFile } : {}) }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/stop",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const flowId = String(body.flowId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
    const s = await tracker.read(flowId);
    if (!s) { res.end(JSON.stringify({ ok: false, error: `未知流 ${flowId}` })); return; }
    if (s.status !== "running") { res.end(JSON.stringify({ ok: false, error: `流 ${flowId} 非运行中（${s.status}），无需停止` })); return; }
    if (s.host && s.host !== os.hostname()) { res.end(JSON.stringify({ ok: false, error: `流属于其他主机 ${s.host}，无法在此停止` })); return; }
    // #5：kill 前先探活（signal 0），避免 pid 复用误杀无关进程；进程已不在则跳过 kill 直接落 stopped 收敛。
    if (typeof s.pid === "number") {
      let alive = true; try { process.kill(s.pid, 0); } catch { alive = false; }
      if (alive) { try { process.kill(s.pid, "SIGTERM"); } catch { /* 竞态下刚退出 */ } }
    }
    await tracker.markStopped(flowId);
    // #2：plan 派生流共享 plan 主进程 pid，杀进程会终止整条 plan——把同 planId 的其它 running 流一并落 stopped，
    // 否则它们成幽灵 running、虚报 board.json activeFlows 并发度（reconcile 只在 serve 启动跑、补不上）。
    let siblings = 0;
    if (s.planId) {
      for (const o of await tracker.list()) {
        if (o.planId === s.planId && o.flowId !== flowId && o.status === "running") { await tracker.markStopped(o.flowId); siblings++; }
      }
    }
    res.end(JSON.stringify({ ok: true, note: s.planId ? `已停止方案 ${s.planId}（含 ${1 + siblings} 条流）` : `已停止流 ${flowId}` }));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/rerun",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const flowId = String(body.flowId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
    const s = await tracker.read(flowId);
    if (!s) { res.end(JSON.stringify({ ok: false, error: `未知流 ${flowId}` })); return; }
    try {
      let args: string[];
      if (s.planId) {
        const plan = await new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")).read(s.planId).catch(() => null);
        const planRef = plan?.meta?.planRef ? String(plan.meta.planRef) : "";
        if (!planRef) { res.end(JSON.stringify({ ok: false, error: `方案 ${s.planId} 未记录 planRef，无法重跑（旧流）` })); return; }
        args = planArgs(planRef, repoRoot);
      } else {
        args = runArgs(s.requirement, repoRoot);
      }
      const { pid, logPath } = launchKunpeng({ execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn }, args, repoRoot);
      res.end(JSON.stringify({ ok: true, pid, logPath, note: `已重跑 ${s.planId ? "方案 " + s.planId : "流 " + flowId}` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
