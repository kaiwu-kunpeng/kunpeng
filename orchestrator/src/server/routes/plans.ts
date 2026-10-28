import type { ServerResponse } from "node:http";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { ArtifactStore } from "../../artifacts/store.js";
import { renderEvalReport, type ReplayResult } from "../../evolution/eval-report.js";
import { runGc } from "../../git/gc.js";
import type { ProposalEvidence } from "../../loop/self-evolution.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { FlowTracker } from "../../runtime/flowstate.js";
import { currentProfileId } from "../auth-context.js";
import { profileProjects, resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

function isForbiddenProject(projectId: string, context: RouteContext): boolean {
  const profileId = currentProfileId();
  if (!profileId || !projectId) return false;
  try {
    const projects = profileProjects(profileId, context.stateDir);
    if (!projects.some((project) => project.id === projectId)) throw new Error(`FORBIDDEN_PROJECT:${projectId}`);
    return false;
  } catch (error) {
    return String((error as Error).message ?? error).startsWith("FORBIDDEN_PROJECT:");
  }
}

function sendForbiddenProject(res: ServerResponse): void {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "无权访问该项目" }));
}

registerModularRoute({
  method: "POST",
  path: "/api/edit-proposal",
  handle: async (req, res, url, context: RouteContext) => {
    const reqBody = await readJsonBody(req);
    const projectId = String(reqBody.projectId ?? "");
    const id = String(reqBody.id ?? "");
    const newBody = String(reqBody.body ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      const cur = await store.read(id);
      // #3：只允许改 draft（待批准）提案；approved/终态不可再改 body。
      if (cur.status !== "draft") { res.end(JSON.stringify({ ok: false, error: `提案 ${id} 状态为 ${cur.status}，仅 draft（待批准）可编辑` })); return; }
      await store.write({ ...cur, body: newBody });
      // #1：写后立即读回校验，不一致即回滚并 fail-loud（绝不静默丢数据）。用 trimEnd（只规整尾换行）
      // 而非 trim——store.read 的 trimStart 会吞正文前导空白（如缩进代码块首行），trim 比对会掩盖这种丢失。
      const back = await store.read(id);
      if (back.body.trimEnd() !== newBody.trimEnd()) {
        await store.write(cur);  // 回滚到原内容
        res.end(JSON.stringify({ ok: false, error: "提案内容含无法安全保存的格式（如以 --- 或缩进空白开头的行），已不作改动，请调整后重试" })); return;
      }
      res.end(JSON.stringify({ ok: true, note: `提案 ${id} 已更新（批准前可继续改）` }));
    } catch { res.end(JSON.stringify({ ok: false, error: `提案 ${id} 不存在或读取失败` })); }  // #4：不回显文件系统路径
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/proposal-body",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const id = String(q.get("id") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const cur = await new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")).read(id);
      res.end(JSON.stringify({ ok: true, body: cur.body }));
    } catch { res.end(JSON.stringify({ ok: false, error: `提案 ${id} 不存在或读取失败` })); }  // #4：不回显文件系统路径
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/eval-report",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const id = String(q.get("id") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const art = await new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")).read(id);
      const ev = (art.meta as { proposal?: { evidence?: ProposalEvidence } } | undefined)?.proposal?.evidence;
      if (!ev || !Number.isFinite(ev.holdoutPassK)) {
        res.end(JSON.stringify({ ok: false, error: `提案 ${id} 无评测证据` }));
        return;
      }
      const replay: ReplayResult = {
        baselinePassK: ev.baseline?.holdoutPassK ?? 0,
        candidatePassK: ev.holdoutPassK,
        costPerResolvedTask: ev.costPerResolvedTask ?? 0,
        tasks: [],
        measuredAt: ev.measuredAt,
      };
      const title = (art.body.split("\n").find((l) => l.trim()) ?? id).slice(0, 80);
      const report = renderEvalReport(replay, { proposalId: id, proposalTitle: title });
      res.end(JSON.stringify({ ok: true, report }));
    } catch { res.end(JSON.stringify({ ok: false, error: `提案 ${id} 不存在或读取失败` })); }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/flow-log",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const flowId = String(q.get("flowId") ?? "");
    res.setHeader("content-type", "application/json");
    if (isForbiddenProject(projectId, context)) {
      sendForbiddenProject(res);
      return;
    }
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    const s = await new FlowTracker(resolveProjectStateDir(repoRoot)).read(flowId);
    if (!s?.logPath) { res.end(JSON.stringify({ ok: false, error: `流 ${flowId} 无日志（旧流或未记录）` })); return; }
    // 防穿越用 realpath 解析符号链接后再比对——纯词法 pathResolve 挡不住 cockpit/logs 内指向外部的软链。
    const logsRoot = join(repoRoot, ".kunpeng", "cockpit", "logs");
    let rpRoot: string, rp: string;
    try { rpRoot = await realpath(logsRoot); rp = await realpath(s.logPath); }
    catch { res.end(JSON.stringify({ ok: false, error: "日志路径无效" })); return; }
    if (rp !== rpRoot && !rp.startsWith(rpRoot + sep)) {
      res.end(JSON.stringify({ ok: false, error: "日志路径越界" }));
      return;
    }
    try {
      const buf = await readFile(rp);
      const tail = buf.length > 65536 ? buf.subarray(buf.length - 65536) : buf;
      res.end(JSON.stringify({ ok: true, log: tail.toString("utf8"), truncated: buf.length > 65536 }));
    } catch {
      res.end(JSON.stringify({ ok: false, error: "日志文件不存在或读取失败" }));
    }
    return;
  },
});

// P0 Evidence View：取某条流的验证证据（dev-cycle 在 verified/rolled-back 各写一条 exp-<flowId>-* experience，meta 带 evidence/outcome/reason）。
registerModularRoute({
  method: "GET",
  path: "/api/evidence",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const flowId = String(q.get("flowId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const exps = (await new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts")).list("experience"))
        .filter((a) => (a.meta as { sourceFlow?: string })?.sourceFlow === flowId)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      // 优先取带 evidence 的最新一条；无则取最新一条；都无则空。
      const withEv = exps.filter((a) => (a.meta as { evidence?: string })?.evidence);
      const chosen = withEv[withEv.length - 1] ?? exps[exps.length - 1];
      const meta = (chosen?.meta ?? {}) as { outcome?: string; evidence?: string; reason?: string };
      const flow = await new FlowTracker(resolveProjectStateDir(repoRoot)).read(flowId);
      res.end(JSON.stringify({
        ok: true,
        flowId,
        outcome: meta.outcome ?? flow?.status ?? "未知",
        reason: meta.reason ?? flow?.blocker ?? "",
        evidence: meta.evidence ?? "",
        hasEvidence: Boolean(meta.evidence),
      }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/plans",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const repoRoot = await resolveRepo(context, String(q.get("projectId") ?? ""));
    res.setHeader("content-type", "application/json");
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: "未知项目" })); return; }
    const dir = join(repoRoot, ".kunpeng", "cockpit", "plans");
    let names: string[];
    try { names = (await readdir(dir)).filter((f) => f.endsWith(".md")); } catch { names = []; }
    res.end(JSON.stringify({ ok: true, plans: names }));
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/plan-file",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const repoRoot = await resolveRepo(context, String(q.get("projectId") ?? ""));
    const name = basename(String(q.get("name") ?? ""));
    res.setHeader("content-type", "application/json");
    if (!repoRoot || !name.endsWith(".md")) { res.end(JSON.stringify({ ok: false, error: "参数无效" })); return; }
    try {
      const body = await readFile(join(repoRoot, ".kunpeng", "cockpit", "plans", name), "utf8");
      res.end(JSON.stringify({ ok: true, name, body }));
    } catch {
      res.end(JSON.stringify({ ok: false, error: "方案不存在" }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/save-plan",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const repoRoot = await resolveRepo(context, String(body.projectId ?? ""));
    let name = basename(String(body.name ?? "")).replace(/[^\w.\-一-龥]/g, "_");
    const planBody = String(body.body ?? "");
    res.setHeader("content-type", "application/json");
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: "未知项目" })); return; }
    if (!name || name === ".md") { res.end(JSON.stringify({ ok: false, error: "方案名为空" })); return; }
    if (!name.endsWith(".md")) name += ".md";
    try {
      const dir = join(repoRoot, ".kunpeng", "cockpit", "plans");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), planBody, "utf8");
      res.end(JSON.stringify({ ok: true, name, note: `方案 ${name} 已保存（可在「方案管理」一键启动）` }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/gc",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const repoRoot = await resolveRepo(context, String(body.projectId ?? ""));
    res.setHeader("content-type", "application/json");
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: "未知项目" })); return; }
    try {
      const r = await runGc({ repoRoot, dryRun: Boolean(body.dryRun) });
      res.end(JSON.stringify({ ok: true, ...r, note: `分支已删 ${r.deleted.length} · 保留 ${r.kept.length} · 过期日志已清 ${r.logsDeleted}` }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: `gc 失败（base 无效?）：${String(e)}` }));
    }
    return;
  },
});
