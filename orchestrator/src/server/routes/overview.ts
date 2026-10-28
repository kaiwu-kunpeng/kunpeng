import { collectExternalBoards } from "../../board/watch.js";
import { kunpengStateDir } from "../../project/registry.js";
import { currentProfileId } from "../auth-context.js";
import { sendMaybeGzip } from "../http-compress.js";
import { profileProjects } from "../project-scope.js";
import { dashboardProjects, singleSnapshot, snapshotsForProjects } from "../snapshots.js";
import { collectMultiState } from "../state.js";
import { registerModularRoute, type ModularRoute } from "./registry.js";

registerModularRoute({
  method: "GET",
  path: "/api/projects",
  handle: async (_req, res, _url, context) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, projects: await dashboardProjects(context) }));
    return;
  },
});

const handlePills: ModularRoute["handle"] = async (_req, res, _url, context) => {
  const profileId = currentProfileId();
  const snaps = context.repoRoot
    ? await singleSnapshot(context.repoRoot)
    : profileId
      ? await snapshotsForProjects(profileProjects(profileId, context.stateDir))
      : await collectMultiState(context.stateDir ?? "");
  let running = 0;
  let gates = 0;
  for (const snap of snaps) {
    if (Array.isArray(snap.state.running)) running += snap.state.running.length;
    if (Array.isArray(snap.state.humanGates)) gates += snap.state.humanGates.length;
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ running, gates }));
  return;
};

registerModularRoute({ method: "GET", path: "/api/pills", handle: handlePills });
registerModularRoute({ method: "POST", path: "/api/pills", handle: handlePills });

const handleState: ModularRoute["handle"] = async (req, res, _url, context) => {
  const profileId = currentProfileId();
  const projects = context.repoRoot
    ? await singleSnapshot(context.repoRoot)
    : profileId
      ? await snapshotsForProjects(profileProjects(profileId, context.stateDir))
      : await collectMultiState(context.stateDir ?? "");
  // 跨工具聚合：watch 列表里各项目的 board.json（kunpeng/codex/任何工具写的）。
  const boards = await collectExternalBoards(context.stateDir ?? kunpengStateDir()).catch(() => []);
  await sendMaybeGzip(req, res, JSON.stringify({ projects, boards }), "application/json; charset=utf-8");
  return;
};

registerModularRoute({ method: "GET", path: "/api/state", handle: handleState });
registerModularRoute({ method: "POST", path: "/api/state", handle: handleState });
