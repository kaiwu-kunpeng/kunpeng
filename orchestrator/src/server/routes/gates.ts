import type { IncomingMessage, ServerResponse } from "node:http";
import { FlowTracker, parseDurationTier } from "../../runtime/flowstate.js";
import { diagnoseGate } from "../../runtime/gate-diagnosis.js";
import { gitGateAdapter } from "../../runtime/gate-git.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { readProjectSelf } from "../../project/registry.js";
import { currentUsername } from "../auth-context.js";
import { gateDiff } from "../gate-diff.js";
import { fileMergeOverruleIfAny } from "../inbox-overrule.js";
import { gateProjects, resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { listFlowsCached } from "../state.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "GET",
  path: "/api/gates/diagnosis",
  handle: async (_req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const gates: unknown[] = [];
      for (const repo of await gateProjects(context)) {
        let flows;
        try {
          flows = await listFlowsCached(repo);
        } catch {
          continue;
        }
        const adapter = gitGateAdapter(repo);
        for (const f of flows) {
          if (!f.humanGate || !String(f.humanGate.gate).includes("合并主干")) continue;
          try {
            gates.push(await diagnoseGate(adapter, f.flowId, "main"));
          } catch {
            gates.push({ flowId: f.flowId, status: "mergeable", commitsBehind: 0, conflictFiles: [] });
          }
        }
      }
      res.end(JSON.stringify({ ok: true, gates }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/gates/discard",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const flowId = String(body.flowId ?? "");
      const tier = parseDurationTier(body.durationTier);
      if (!flowId) {
        res.end(JSON.stringify({ ok: false, error: "缺 flowId" }));
        return;
      }

      let cleared = false;
      for (const repo of await gateProjects(context)) {
        const tracker = new FlowTracker(resolveProjectStateDir(repo));
        let flows;
        try {
          flows = await tracker.list();
        } catch {
          continue;
        }
        const flow = flows.find((f) => f.flowId === flowId);
        if (flow) {
          await tracker.clearGate(flowId, { by: "human", via: "cockpit-discard", ...(tier ? { durationTier: tier } : {}) });
          cleared = true;
          try {
            await fileMergeOverruleIfAny({
              repoRoot: repo, stateDir: tracker.stateDir, flow, decision: "reject", via: "cockpit-discard",
              who: currentUsername() || undefined, projectId: (await readProjectSelf(repo))?.id,
            });
          } catch (e) { console.warn(`[inbox-overrule] 驳回后起草改判提案失败（${flowId}）：`, e); }
          break;
        }
      }

      res.end(JSON.stringify(cleared ? { ok: true } : { ok: false, error: "未找到该门" }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  },
});

const gateDiffHandle = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  context: RouteContext,
): Promise<void> => {
  res.setHeader("content-type", "application/json");
  const parsed = new URL(url, "http://127.0.0.1");
  const projectId = parsed.searchParams.get("projectId") ?? "";
  const flowId = parsed.searchParams.get("flowId") ?? "";
  const target = parsed.searchParams.get("target") ?? "main";
  if (!flowId.trim()) {
    res.end(JSON.stringify({ ok: false, error: "缺 flowId" }));
    return;
  }
  const repoRoot = await resolveRepo(context, projectId);
  if (!repoRoot) {
    res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
    return;
  }
  res.end(JSON.stringify(await gateDiff(repoRoot, flowId, target)));
  return;
};

registerModularRoute({
  method: "GET",
  path: "/api/gate-diff",
  handle: gateDiffHandle,
});

registerModularRoute({
  method: "GET",
  path: "/api/gates/diff",
  handle: gateDiffHandle,
});
