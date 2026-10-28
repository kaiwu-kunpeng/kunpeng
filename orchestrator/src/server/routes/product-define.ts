import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliRunner } from "../../agent/cli-runner.js";
import { productSlug } from "../../product/artifacts.js";
import { envInit, envPreflight } from "../../product/env-init.js";
import { startInterview, submitAnswer, isAllAnswered } from "../../product/interview.js";
import { draftSpecForDefinition, loadLoopView } from "../../product/loop-orchestrate.js";
import { buildProductPlan } from "../../product/plan.js";
import { readRegistry as readProductRegistry } from "../../product/registry.js";
import { listProductsView } from "../../product/registry-service.js";
import { PRODUCT_TEMPLATES, mergeTemplateStories, templateById } from "../../product/product-templates.js";
import { readInterview, writeInterview } from "../../product/store.js";
import { completeInterview } from "../../product/summarize.js";
import { definitionToSpec } from "../../product/to-spec.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

// 产品轨 DEFINE 访谈：开始 / 答题（末轮 agent 汇总成产品定义）/ 转 spec 草稿。后端纯函数来自 src/product/。
registerModularRoute({
  method: "GET",
  path: "/api/product/templates",
  handle: async (_req, res, _url, _context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, templates: PRODUCT_TEMPLATES }));
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/product/env",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      res.end(JSON.stringify({ ok: true, env: await envPreflight(repoRoot) }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/env/init",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const { ran } = await envInit(repoRoot);
      res.end(JSON.stringify({ ok: true, ran }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product-start",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const idea = String(body.idea ?? "").trim();
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!idea) { res.end(JSON.stringify({ ok: false, error: "产品想法不能为空" })); return; }
    try {
      await writeInterview(repoRoot, startInterview(idea));
      res.end(JSON.stringify({ ok: true, note: "已开始 DEFINE 访谈" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product-answer",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const answer = String(body.answer ?? "").trim();
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!answer) { res.end(JSON.stringify({ ok: false, error: "回答不能为空" })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session) { res.end(JSON.stringify({ ok: false, error: "无进行中的访谈，请先开始" })); return; }
      let next = submitAnswer(session, answer);
      if (isAllAnswered(next)) {
        next = await completeInterview(next, new CliRunner());  // 末轮：agent 汇总成产品定义并置 done
      }
      await writeInterview(repoRoot, next);
      // 自动起草 spec（机器生成下一份产物；人随后在 UI 里看/改/接受）
      if (next.status === "done" && next.definition) {
        const slug = productSlug(next.definition.idea);
        const reg = await readProductRegistry(repoRoot);
        const entry = reg.products.find((product) => product.slug === slug);
        const template = entry?.template ? templateById(entry.template) : undefined;
        const definition = template ? mergeTemplateStories(next.definition, template) : next.definition;
        await draftSpecForDefinition(repoRoot, definition, Date.now());
      }
      res.end(JSON.stringify({ ok: true, note: next.status === "done" ? "访谈完成，已生成产品定义与 spec 草稿" : "已提交回答" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product-to-spec",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "访谈未完成或无产品定义，无法转 spec" })); return; }
      const dir = join(repoRoot, ".kunpeng", "product");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "draft-spec.md"), definitionToSpec(session.definition), "utf8");
      res.end(JSON.stringify({ ok: true, note: "已生成 spec 草稿 → .kunpeng/product/draft-spec.md" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/product/plan",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) {
      res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` }));
      return;
    }
    try {
      const plan = await buildProductPlan(repoRoot);
      res.end(JSON.stringify({ ok: true, plan }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/product/state",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const session = await readInterview(repoRoot);
      const slug = session?.definition ? productSlug(session.idea) : undefined;
      const loop = slug ? await loadLoopView(repoRoot, slug) : undefined;
      res.end(JSON.stringify({ ok: true, session, loop }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/product/list",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const products = await listProductsView(repoRoot, Date.now());
      res.end(JSON.stringify({ ok: true, products }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
