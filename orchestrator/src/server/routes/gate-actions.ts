import { join } from "node:path";
import { ArtifactStore } from "../../artifacts/store.js";
import { runAutopilot } from "../../loop/autopilot.js";
import { decideOpsGate, listOpsGates } from "../../loop/ops-gate.js";
import { needsSecondConfirm, syntheticEvidenceAllowed } from "../../policy/action-levels.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { FlowTracker, parseDurationTier } from "../../runtime/flowstate.js";
import { mergeAndClearGate } from "../../runtime/merge-gate.js";
import { currentUsername } from "../auth-context.js";
import { buildAutopilotGuards } from "../autopilot-guards.js";
import { recordArtifactDecision } from "../decision-audit.js";
import { fileMergeOverruleIfAny } from "../inbox-overrule.js";
import { launchKunpeng, loopRunArgs } from "../launch.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { consumeConfirmToken, issueConfirmToken } from "../second-confirm.js";
import { registerModularRoute, type ModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/merge",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const flowId = String(body.flowId ?? "");
    const target = String(body.target ?? "main");
    const tier = parseDurationTier(body.durationTier);
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    const stateDir = resolveProjectStateDir(repoRoot);
    const flow = await new FlowTracker(stateDir).read(flowId);
    const r = await mergeAndClearGate(repoRoot, flowId, target, { allowSensitive: true, clearedBy: { by: "human", via: "cockpit-merge", ...(tier ? { durationTier: tier } : {}) } });
    if (!r.ok) { res.end(JSON.stringify({ ok: false, error: r.error })); return; }
    let overruleProposal: string | undefined;
    try {
      overruleProposal = await fileMergeOverruleIfAny({
        repoRoot, stateDir, flow, decision: "approve", via: "cockpit-merge",
        who: currentUsername() || undefined, projectId,
      });
    } catch (e) { console.warn(`[inbox-overrule] 合并后起草改判提案失败（${flowId}）：`, e); }
    const note = overruleProposal ? `${r.note ?? ""}；已起草改判提案 ${overruleProposal}` : r.note;
    res.end(JSON.stringify({ ok: true, note, ...(overruleProposal ? { overruleProposal } : {}) }));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/autopilot",
  handle: async (req, res, url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const projectId = String(body.projectId ?? "");
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
      const result = await runAutopilot({
        tracker,
        merge: (flowId, base) => mergeAndClearGate(repoRoot, flowId, base, { clearedBy: { by: "machine", via: "autopilot-api" } }),
        ...buildAutopilotGuards(repoRoot, tracker),
      });
      res.end(JSON.stringify({
        ok: true,
        merged: result.merged,
        rejected: result.rejected,
        skipped: result.skipped,
        note: `自动合并 ${result.merged.length} 条，自动驳回 ${result.rejected.length} 条，跳过 ${result.skipped.length} 条`,
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: (e as Error).message ?? String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/approve-connector",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      const artifact = await store.read(id);
      if (artifact.kind !== "connector") {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: `只能放行 connector 动作，${id} 是 ${artifact.kind}` }));
        return;
      }
      await store.transition(id, "approved");
      await recordArtifactDecision(store, join(repoRoot, ".kunpeng", "audit", "decisions.jsonl"), {
        id, decision: "approved", via: "cockpit", who: currentUsername() || undefined, projectId,
      });
      res.end(JSON.stringify({ ok: true, note: `已放行 connector 动作 ${id}` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/approve",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      const artifact = await store.read(id);
      if (artifact.kind === "release" || artifact.kind === "connector") {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: `${artifact.kind} 须走专用确认路由，不能用通用批准` }));
        return;
      }
      await store.transition(id, "approved");
      await recordArtifactDecision(store, join(repoRoot, ".kunpeng", "audit", "decisions.jsonl"), {
        id, decision: "approved", via: "cockpit", who: currentUsername() || undefined, projectId,
      });
      res.end(JSON.stringify({ ok: true, note: "提案已批准（记录人工决定）。应用到 conventions 是独立人工步骤。" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/confirm-release",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      const artifact = await store.read(id);
      if (artifact.meta.syntheticEvidence === true && !syntheticEvidenceAllowed("L4")) {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: "合成证据不能推动 L4 动作（C5）" }));
        return;
      }
      const key = `${projectId}:${id}`;
      const token = typeof body.confirmToken === "string" ? body.confirmToken : "";
      if (needsSecondConfirm("L4") && !consumeConfirmToken(key, token)) {
        res.end(JSON.stringify({ ok: false, needConfirm: true, confirmToken: issueConfirmToken(key), error: `L4 硬门需二次确认：再次确认后才会发布 ${id}` }));
        return;
      }
      await store.transition(id, "approved");
      await recordArtifactDecision(store, join(repoRoot, ".kunpeng", "audit", "decisions.jsonl"), {
        id, decision: "approved", via: "cockpit", who: currentUsername() || undefined, projectId,
      });
      res.end(JSON.stringify({ ok: true, note: `已确认发布 ${id}` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/reject",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      await store.transition(id, "rolled-back");
      await recordArtifactDecision(store, join(repoRoot, ".kunpeng", "audit", "decisions.jsonl"), {
        id, decision: "rejected", via: "cockpit", who: currentUsername() || undefined, projectId,
      });
      res.end(JSON.stringify({ ok: true, note: "提案已拒绝（记为 rolled-back，不再进人审队列）" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

const opsGatesRoute = {
  method: "POST",
  path: "/api/ops-gates",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const gates = await listOpsGates(repoRoot);
      res.end(JSON.stringify({ gates }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
} satisfies ModularRoute;

registerModularRoute(opsGatesRoute);
registerModularRoute({ ...opsGatesRoute, method: "GET" });

registerModularRoute({
  method: "POST",
  path: "/api/ops-gate-decide",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "").trim();
    const decision = String(body.decision ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      if (decision === "approve") {
        // L4 硬门（对外不可逆或花钱）在服务端强制二次确认：前端点两次只是体验，真正的闸在这里。
        const target = (await listOpsGates(repoRoot)).find((gate) => gate.id === id);
        if (target && needsSecondConfirm(target.level) && body.confirmed !== true) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: `${target.level} 硬门需二次确认：请再次确认后以 confirmed:true 提交` }));
          return;
        }
        const decided = await decideOpsGate(repoRoot, id, "approved", { by: "human", via: "cockpit" });
        if (!decided) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "人工门不存在或已裁决" }));
          return;
        }
        if (!decided.loopId.trim()) {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
        const { pid } = launchKunpeng(
          { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
          loopRunArgs(decided.loopId, repoRoot),
          repoRoot,
        );
        res.end(JSON.stringify({ ok: true, pid }));
        return;
      }
      if (decision === "reject") {
        const decided = await decideOpsGate(repoRoot, id, "rejected", { by: "human", via: "cockpit" });
        if (!decided) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "人工门不存在或已裁决" }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "未知裁决" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
