import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { instantiateTemplate, resolveApplyTargetRepo, selectAutoRunLoops } from "../../loop/solution-template.js";
import { readRegistry, kunpengStateDir, type ProjectEntry } from "../../project/registry.js";
import { currentProfileId } from "../auth-context.js";
import { buildArchitectureGraph } from "../ui/views/architecture-graph.js";
import { launchKunpeng, loopRunArgs, type SpawnFn } from "../launch.js";
import { profileProjects, resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { collectDashboardState } from "../snapshots.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

function launchDepsForOps(context: RouteContext): { execPath: string; cliJs: string; spawn?: SpawnFn } {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiledCliJs = join(here, "..", "..", "cli.js");
  const sourceCliJs = join(here, "..", "..", "..", "dist", "cli.js");
  return {
    execPath: context.execPath ?? process.execPath,
    cliJs: context.cliJs ?? (existsSync(compiledCliJs) ? compiledCliJs : sourceCliJs),
    spawn: context.spawn,
  };
}

interface AutoRunResult {
  loopId: string;
  pid: number;
  logPath: string;
}

const SAFE_LOOP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function launchSolutionAutoRunLoops(context: RouteContext, repoRoot: string, loopIds: string[]): AutoRunResult[] {
  const autoRun: AutoRunResult[] = [];
  const launchDeps = launchDepsForOps(context);
  for (const loopId of loopIds) {
    if (!SAFE_LOOP_ID_PATTERN.test(loopId)) {
      console.warn(`[solution] 跳过非法自动首波 loopId: ${loopId}`);
      continue;
    }
    try {
      const { pid, logPath } = launchKunpeng(
        launchDeps,
        loopRunArgs(loopId, repoRoot),
        repoRoot,
      );
      autoRun.push({ loopId, pid, logPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[solution] 自动首波 ${loopId} 启动失败: ${message}`);
    }
  }
  return autoRun;
}

registerModularRoute({
  method: "GET",
  path: "/api/arch-graph",
  handle: async (_req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const dash = await collectDashboardState(context);
    res.end(JSON.stringify(buildArchitectureGraph(dash)));
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/solutions/apply",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const body = await readJsonBody(req);
    if (typeof body.id !== "string" || typeof body.projectId !== "string") {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "缺 id 或 projectId" }));
      return;
    }

    const id = body.id;
    const projectId = body.projectId;
    let targetRepo: string;
    let registry: ProjectEntry[] = [];
    if (context.repoRoot) {
      targetRepo = context.repoRoot;
    } else {
      try {
        const profileId = currentProfileId();
        registry = profileId
          ? profileProjects(profileId, context.stateDir)
          : await readRegistry(context.stateDir ?? kunpengStateDir()).catch((): ProjectEntry[] => []);
        targetRepo = resolveApplyTargetRepo(projectId, registry, undefined);
      } catch (error) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
        return;
      }
    }

    try {
      const registryName = registry.find((project) => project.id === projectId)?.name;
      const projectName = typeof registryName === "string" && registryName.trim() !== "" ? registryName : projectId;
      const result = instantiateTemplate(join(context.stateDir ?? kunpengStateDir(), "solutions"), id, targetRepo, projectId, { projectName });
      const autoRun = body.run === true
        ? launchSolutionAutoRunLoops(context, targetRepo, selectAutoRunLoops(targetRepo, result.loopsWritten))
        : [];
      res.end(JSON.stringify({
        ok: true,
        ...result,
        configsWritten: result.configsWritten,
        configsSkipped: result.configsSkipped,
        autoRun,
      }));
    } catch (error) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/ops/run",
  handle: async (req, res, _url, context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    const body = await readJsonBody(req);
    if (typeof body.projectId !== "string" || typeof body.loopId !== "string" || !body.projectId.trim() || !body.loopId.trim()) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "缺 projectId 或 loopId" }));
      return;
    }

    const projectId = body.projectId;
    const loopId = body.loopId;
    if (!SAFE_LOOP_ID_PATTERN.test(loopId)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "缺 projectId 或 loopId" }));
      return;
    }

    const repoPath = await resolveRepo(context, projectId);
    if (!repoPath) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "未知项目: " + projectId }));
      return;
    }

    try {
      const { pid, logPath } = launchKunpeng(
        launchDepsForOps(context),
        loopRunArgs(loopId, repoPath),
        repoPath,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath }));
    } catch (error) {
      res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
    }
    return;
  },
});
