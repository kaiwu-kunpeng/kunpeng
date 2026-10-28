import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { qaWithFixTask } from "../../product/browser-qa.js";
import { publishLocal } from "../../product/publish.js";
import { readPreview, startPreview, stopPreview } from "../../product/preview.js";
import { commitWorkspaceVersion, productWorkspaceDir } from "../../product/workspace.js";
import { createTask } from "../../task/store.js";
import { freeTcpPort } from "../net-util.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { buildCheckupResponse } from "./checkup-verdict.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/product/preview/start",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const rawPort = body.port;
      const port = rawPort === undefined ? await freeTcpPort() : Number(rawPort);
      if (!Number.isInteger(port) || port <= 0) { res.end(JSON.stringify({ ok: false, error: "port 必须是正整数" })); return; }
      const ws = productWorkspaceDir(repoRoot, slug);
      const preview = existsSync(join(ws, "package.json"))
        ? await startPreview(repoRoot, slug, { port, cwd: ws })
        : await startPreview(repoRoot, slug, { port });
      res.end(JSON.stringify({ ok: true, preview }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/checkup",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const preview = await readPreview(repoRoot, slug);
      let previewStarted = false;
      let previewUrl = preview?.alive ? preview.url : "";
      if (!preview?.alive) {
        const port = await freeTcpPort();
        const ws = productWorkspaceDir(repoRoot, slug);
        const startedPreview = existsSync(join(ws, "package.json"))
          ? await startPreview(repoRoot, slug, { port, cwd: ws })
          : await startPreview(repoRoot, slug, { port });
        previewUrl = startedPreview.url;
        previewStarted = true;
      }
      const qa = await qaWithFixTask(repoRoot, slug, previewUrl, Date.now());
      const committed = await commitWorkspaceVersion(repoRoot, slug, `一键验收 QA ${qa.ok ? "通过" : "未过"}`)
        .then(() => true)
        .catch(() => false);
      const response = buildCheckupResponse({
        qaOk: qa.ok,
        issueCount: Array.isArray(qa.problems) ? qa.problems.length : qa.ok ? 0 : 1,
        committed,
        previewUrl,
        previewStarted,
      });
      res.end(JSON.stringify({ ...response, qa }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/preview/stop",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const stopped = await stopPreview(repoRoot, slug);
      res.end(JSON.stringify({ ok: true, stopped }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/publish",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const publish = await publishLocal(repoRoot, slug, Date.now());
      res.end(JSON.stringify({ ok: true, publish }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/qa",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const preview = await readPreview(repoRoot, slug);
      if (!preview?.alive) { res.end(JSON.stringify({ ok: false, error: "无运行中的预览，先启动预览" })); return; }
      const result = await qaWithFixTask(repoRoot, slug, preview.url, Date.now());
      await commitWorkspaceVersion(repoRoot, slug, `QA ${result.ok ? "通过" : "未过"}`).catch(() => {});
      res.end(JSON.stringify(result));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/pick-task",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const selector = String(body.selector ?? "").trim();
    const text = String(body.text ?? "");
    const instruction = String(body.instruction ?? "").trim();
    res.setHeader("content-type", "application/json");
    if (!projectId) { res.end(JSON.stringify({ ok: false, error: "projectId 不能为空" })); return; }
    if (!slug) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    if (!selector) { res.end(JSON.stringify({ ok: false, error: "selector 不能为空" })); return; }
    if (!instruction) { res.end(JSON.stringify({ ok: false, error: "instruction 不能为空" })); return; }
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    const nowIso = new Date().toISOString();
    try {
      await createTask(repoRoot, {
        id: `task-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
        title: `定点修改：${instruction.slice(0, 40)}`,
        type: "product-pick",
        projectId,
        status: "ready",
        createdAt: nowIso,
        updatedAt: nowIso,
        goal: `按拾取元素完成定点修改：${instruction}`,
        context: [
          `产品：${slug}`,
          `元素：${selector}`,
          `拾取文本：${text}`,
          `完整修改要求：${instruction}`,
        ].join("\n"),
        acceptanceCriteria: [
          "指定元素按修改要求完成更新。",
          "相关产品预览可正常打开并验证修改结果。",
        ],
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/product/preview",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const slug = String(q.get("slug") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const preview = await readPreview(repoRoot, slug);
      res.end(JSON.stringify({ ok: true, preview: preview ?? null }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
