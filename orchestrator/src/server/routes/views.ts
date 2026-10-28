import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { sendMaybeGzip } from "../http-compress.js";
import { resolveRepo } from "../project-scope.js";
import { collectDashboardState, dashboardProjects } from "../snapshots.js";
import { renderViewFragment } from "../ui/render-view.js";
import {
  collectOverviewState,
  collectProjectDashboardState,
  docsDir,
  isForbiddenProject,
  isOverviewRoute,
  parseProjectRoute,
  repoProjectName,
  routeForProjectView,
  sendForbiddenProject,
} from "../view-state.js";
import { registerModularRoute } from "./registry.js";

// 设计候选预览 PNG/HTML 静态服务：/previews/<projectId>/<file>
export async function handlePreviewsRoute(
  method: string,
  url: string,
  res: ServerResponse,
  opts: { repoRoot?: string; stateDir?: string },
): Promise<boolean> {
  if (method !== "GET" || !url.startsWith("/previews/")) return false;
  const parts = url.slice("/previews/".length).split("/");
  const projectId = decodeURIComponent(parts[0] ?? "");
  const file = basename(decodeURIComponent((parts[1] ?? "").split("?")[0])); // basename 防路径穿越
  const repoRoot = await resolveRepo(opts, projectId);
  if (!repoRoot || !/\.(png|html)$/.test(file)) { res.statusCode = 404; res.end("not found"); return true; }
  try {
    const buf = await readFile(join(repoRoot, ".kunpeng", "previews", file));
    res.setHeader("content-type", file.endsWith(".png") ? "image/png" : "text/html; charset=utf-8");
    res.end(buf);
  } catch { res.statusCode = 404; res.end("not found"); }
  return true;
}

registerModularRoute({
  method: "GET",
  path: "/doc",
  handle: (req, res) => {
    const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
    if (name !== basename(name) || !name.endsWith(".html") || name.includes("..") || name.includes("/")) {
      res.writeHead(400).end("bad name");
      return;
    }
    const file = join(docsDir(), name);
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      if (!statSync(file).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end("not found");
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/view",
  handle: async (req, res, _url, context) => {
    const searchParams = new URL(req.url ?? "", "http://x").searchParams;
    const route = searchParams.get("route") || "#/overview";
    const selectedProductSlug = searchParams.get("product") || undefined;
    const projectRoute = parseProjectRoute(route);
    if (projectRoute && isForbiddenProject(projectRoute.id, context)) {
      sendForbiddenProject(res);
      return;
    }
    const projects = projectRoute ? await dashboardProjects(context) : [];
    const state = projectRoute
      ? await collectProjectDashboardState(context, projectRoute.id, selectedProductSlug)
      : (isOverviewRoute(route) || route === "#/loops" || route === "#/inbox") ? await collectOverviewState(context) : await collectDashboardState(context);
    const projectName = projectRoute
      ? (projects.find((project) => project.id === projectRoute.id)?.name ?? projectRoute.id)
      : context.repoRoot ? repoProjectName(context.repoRoot) : undefined;
    const projectId = projectRoute ? projectRoute.id : projectName;
    const renderRoute = projectRoute ? routeForProjectView(projectRoute) : route;
    res.setHeader("cache-control", "no-cache");
    await sendMaybeGzip(req, res, renderViewFragment(state, renderRoute, { projectName, projectId }), "text/html; charset=utf-8");
    return;
  },
});
