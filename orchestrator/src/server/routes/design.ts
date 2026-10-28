import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesignBrief } from "../../design/brief-gate.js";
import { planDesign } from "../../design/design-loop.js";
import { DesignMemoryStore } from "../../design/design-memory.js";
import { listDesignPresets } from "../../design/design-presets.js";
import { suggestDesign } from "../../design/design-suggest.js";
import { runDesignPipeline } from "../../design/pipeline.js";
import { designGenerateArgs, designPreviewArgs, launchKunpeng } from "../launch.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/design-codegen",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        ["design-codegen", "--repo", repoRoot],
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, note: "已启动设计代码生成，完成后见产物" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/design-advise",
  handle: async (req, res, _url, _context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const brief = String(body.brief ?? "").trim();
      if (!brief) {
        res.end(JSON.stringify({ ok: false, error: "需求不能为空" }));
        return;
      }
      const r = runDesignPipeline(brief);
      res.end(JSON.stringify({
        ok: true,
        styles: r.advice.styles,
        palette: r.master.palette,
        fonts: r.master.fonts,
        masterMd: r.masterMd,
        css: r.css,
        antiPatternHits: r.antiPatternHits,
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/design-loop",
  handle: async (req, res, _url, _context: RouteContext) => {
    res.setHeader("content-type", "application/json");
    try {
      const body = await readJsonBody(req);
      const brief = (body.brief && typeof body.brief === "object" ? body.brief : {}) as Partial<DesignBrief>;
      // #4 新旧统一:没给 seed/anchors 时用老 knowledge BM25 自动建议(与 CLI 一致)。
      const sugg = suggestDesign([brief.projectType, brief.primaryGoal, brief.tone].filter(Boolean).join(" "));
      const seed = body.seed ? String(body.seed) : (sugg.seedHex ?? "#2563eb");
      const anchors = Array.isArray(body.anchors) && body.anchors.length
        ? body.anchors.map(String)
        : (sugg.anchor ? [sugg.anchor] : undefined);
      let baseline = "";
      let history: Parameters<typeof planDesign>[0]["history"] = [];
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        baseline = await readFile(join(here, "../../src/design/vendor/frontend-design-skill.md"), "utf8");
        history = new DesignMemoryStore(join(here, "../../..", ".kunpeng", "loops", "design-memory")).loadAll();
      } catch { baseline = ""; }
      const plan = planDesign({ brief, seedHex: seed, baseline, anchors, bucket: brief.projectType, history });
      res.end(JSON.stringify({
        ok: plan.ok,
        gate: plan.gate,
        chosenAnchor: plan.chosenAnchor,
        rankedAnchors: plan.rankedAnchors,
        chosenFonts: plan.chosenFonts,
        suggested: { seedHex: sugg.seedHex, anchor: sugg.anchor, styleName: sugg.styleName },
        tokens: plan.tokens,
        systemPrompt: plan.systemPrompt,
        briefMd: plan.briefMd,
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/design-preview",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const sources = typeof body.sources === "string" ? body.sources : undefined;
    const preset = typeof body.preset === "string" ? body.preset : undefined;
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        designPreviewArgs(repoRoot, { sources, preset }),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, note: "候选生成已后台启动，完成后刷新设计候选卡" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/design-presets",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const presets = await listDesignPresets({ rootDir: join(repoRoot, "orchestrator/src/design/vendor/design-systems") });
      res.end(JSON.stringify({ ok: true, presets }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/design-generate",
  handle: async (req, res, url, context: RouteContext) => {
    // #7 面板异步生成:写 brief 临时文件 → 后台 spawn `kunpeng design-loop --generate --rounds N`(含自动回炉+真截图)。
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const brief = (body.brief && typeof body.brief === "object" ? body.brief : {}) as Record<string, unknown>;
      const seed = typeof body.seed === "string" && body.seed ? body.seed : undefined;
      const anchors = Array.isArray(body.anchors) ? body.anchors.map(String) : undefined;
      const rounds = Number(body.rounds) > 0 ? Number(body.rounds) : 2;
      const slug = (String((brief as { projectType?: string }).projectType ?? "design")).replace(/[^a-z0-9一-龥]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "design";
      const briefDir = join(repoRoot, ".kunpeng", "cockpit", "design-briefs");
      await mkdir(briefDir, { recursive: true });
      const briefPath = join(briefDir, `${slug}-${Date.now().toString(36)}.json`);
      await writeFile(briefPath, JSON.stringify(brief), "utf8");
      const outDir = join(repoRoot, ".kunpeng", "design-out", slug);
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        designGenerateArgs(briefPath, outDir, repoRoot, { seed, anchors, rounds }),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, outDir, note: `已后台生成(${rounds}轮回炉),产物落 ${outDir}(index.html / shot.png)` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
