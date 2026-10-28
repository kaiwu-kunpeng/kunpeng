import { dirname } from "node:path";
import { readActions } from "../../loop/action-ledger.js";
import { resolveProjectStateDir } from "../../project/state-resolve.js";
import { resolveRepo } from "../project-scope.js";
import { registerModularRoute } from "./registry.js";

registerModularRoute({
  method: "GET",
  path: "/api/ops/actions",
  handle: async (_req, res, url, context) => {
    const query = new URL(url, "http://localhost").searchParams;
    const requestedDays = Number(query.get("days") ?? "30");
    const days = Number.isFinite(requestedDays) && requestedDays >= 0 ? requestedDays : 30;
    const loopId = query.get("loopId") ?? undefined;
    const projectId = query.get("projectId") ?? undefined;
    const repo = context.repoRoot ?? (projectId ? await resolveRepo(context, projectId) : null);
    if (repo === null) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, actions: [] }));
      return;
    }
    const filters = {
      ...(loopId !== undefined ? { loopId } : {}),
      since: Date.now() - days * 24 * 60 * 60 * 1000,
    };
    const projectStateDir = resolveProjectStateDir(repo);
    const actions = await readActions(projectStateDir, filters);
    if (actions.length === 0 && context.repoRoot !== undefined) {
      actions.push(...await readActions(dirname(projectStateDir), filters));
    }

    actions.sort((a, b) => b.at - a.at);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, actions }));
  },
});
