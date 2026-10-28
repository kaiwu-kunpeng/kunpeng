import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliRunner } from "../../agent/cli-runner.js";
import { synthesizeFromRef } from "../../product/copy-ref-synth.js"; // moved from "../product/copy-ref-synth.js"
import { fetchRefScrape } from "../../product/fetch-ref.js"; // moved from "../product/fetch-ref.js"
import { restoreCheckpoint, snapshotLoop } from "../../product/loop-checkpoint.js";
import { startProductRun } from "../../product/loop-orchestrate.js";
import { productLoopDir } from "../../product/loop-store.js";
import { readPreview, startPreview, stopPreview } from "../../product/preview.js";
import { templateById } from "../../product/product-templates.js";
import { deleteProduct, hardDeleteProduct, restoreProduct } from "../../product/registry-service.js"; // moved from "../product/registry-service.js"
import { activateProduct } from "../../product/store.js";
import { commitWorkspaceVersion, productWorkspaceDir, restoreWorkspaceVersion } from "../../product/workspace.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/product/new",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const idea = String(body.idea ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!idea.trim()) { res.end(JSON.stringify({ ok: false, error: "产品想法不能为空" })); return; }
    try {
      // startProductRun keeps /api/product/new on the registry create path: createProduct(repoRoot, idea, now).
      const templateId = String(body.template ?? "");
      const template = templateById(templateId);
      const { product, question, note } = await startProductRun(repoRoot, idea, Date.now(), templateId);
      if (template?.qaScriptSeed?.length) {
        try {
          const scriptPath = join(productLoopDir(repoRoot, product.slug), "qa-script.json");
          if (!existsSync(scriptPath)) {
            await mkdir(dirname(scriptPath), { recursive: true });
            await writeFile(scriptPath, `${JSON.stringify(template.qaScriptSeed, null, 2)}\n`, "utf8");
          }
        } catch (e) {
          console.warn(`[product-new] qa-script 种子写入失败：${String(e)}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: "qa-script 种子写入失败" }));
          return;
        }
      }
      res.end(JSON.stringify({ ok: true, product, question, note }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/activate",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const activated = await activateProduct(repoRoot, slug);
      res.end(JSON.stringify({ ok: true, activated }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/snapshot",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    const label = String(body.label ?? "手动存档");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    try {
      const id = await snapshotLoop(repoRoot, slug, label || "手动存档", Date.now());
      await commitWorkspaceVersion(repoRoot, slug, "手动存档").catch(() => {});
      res.end(JSON.stringify({ ok: true, id }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/rollback",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    if (!id.trim()) { res.end(JSON.stringify({ ok: false, error: "id 不能为空" })); return; }
    try {
      const restored = await restoreCheckpoint(repoRoot, slug, id, Date.now());
      res.end(JSON.stringify({ ok: restored, restored }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/ws-restore",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const sha = String(body.sha ?? "").trim();
    res.setHeader("content-type", "application/json");
    if (!projectId) { res.end(JSON.stringify({ ok: false, error: "projectId 不能为空" })); return; }
    if (!slug) { res.end(JSON.stringify({ ok: false, error: "slug 不能为空" })); return; }
    if (!sha) { res.end(JSON.stringify({ ok: false, error: "sha 不能为空" })); return; }
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const ok = await restoreWorkspaceVersion(repoRoot, slug, sha);
      if (ok === undefined) {
        res.end(JSON.stringify({ ok: false, error: "版本不存在或无差异" }));
        return;
      }
      let previewRestarted = false;
      const preview = await readPreview(repoRoot, slug);
      if (preview?.alive) {
        try {
          await stopPreview(repoRoot, slug);
          await startPreview(repoRoot, slug, { port: preview.port, cwd: productWorkspaceDir(repoRoot, slug) });
          previewRestarted = true;
        } catch {
          previewRestarted = false;
        }
      }
      res.end(JSON.stringify({ ok: true, sha, previewRestarted }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/copy-ref",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const rawUrl = String(body.url ?? "");
    const trimmedUrl = rawUrl.trim();
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: "未知项目" })); return; }
    if (!trimmedUrl) { res.end(JSON.stringify({ ok: false, error: "网址不能为空" })); return; }
    try {
      const ref = await fetchRefScrape(trimmedUrl);
      const result = await synthesizeFromRef(repoRoot, ref, new CliRunner(), Date.now());
      res.end(JSON.stringify({ ok: true, product: { slug: result.slug, title: result.title }, ia: result.ia, themeColor: result.themeColor }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/delete",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "产品 slug 不能为空" })); return; }
    try {
      await deleteProduct(repoRoot, slug, reason, Date.now());
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/purge",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "产品 slug 不能为空" })); return; }
    try {
      const purged = await hardDeleteProduct(repoRoot, slug);
      res.end(JSON.stringify({ ok: true, purged }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/restore",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const slug = String(body.slug ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!slug.trim()) { res.end(JSON.stringify({ ok: false, error: "产品 slug 不能为空" })); return; }
    try {
      const restored = await restoreProduct(repoRoot, slug, Date.now());
      res.end(JSON.stringify({ ok: restored, restored }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
