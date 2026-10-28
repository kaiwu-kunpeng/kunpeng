import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliRunner } from "../../agent/cli-runner.js";
import { nextAdrNumber, adrFilename, renderFilledAdr } from "../../dossier/adr.js";
import type { DesignBrief } from "../../design/brief-gate.js";
import { CaptureStore, resolveCapturesDir } from "../../knowledge/capture-store.js";
import { decideSpecAcceptance } from "../../product/accept-gate.js";
import { productSlug } from "../../product/artifacts.js";
import { createTaskBatchForBuild } from "../../product/build-tasks.js";
import { assessConcreteness } from "../../product/concreteness.js";
import { envPreflight, type EnvCheck } from "../../product/env-init.js";
import { writeGrowthFiles } from "../../product/growth-files.js";
import { validationAdrSections } from "../../product/loop-close.js";
import { snapshotLoop } from "../../product/loop-checkpoint.js";
import { acceptStageWithCheckpoint, draftBuildSpec, recordAndClose, applyPivot } from "../../product/loop-orchestrate.js";
import { writeSpec, writeBrief, readBrief, productLoopDir, readLoopState, writeBuildSpec } from "../../product/loop-store.js";
import { readRegistry as readProductRegistry } from "../../product/registry.js";
import { canAcceptStage, isProductStage } from "../../product/stage-machine.js";
import { templateById, templateConventionsBlock, templateObjectsBlock } from "../../product/product-templates.js";
import { readInterview } from "../../product/store.js";
import { ensureWorkspace } from "../../product/workspace.js";
import { registerProject, kunpengStateDir } from "../../project/registry.js";
import { appendAudit } from "../audit.js";
import { currentUsername } from "../auth-context.js";
import { launchKunpeng, planArgs, designGenerateArgs } from "../launch.js";
import { resolveRepo } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

registerModularRoute({
  method: "POST",
  path: "/api/product/spec/save",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const spec = String(body.spec ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!spec.trim()) { res.end(JSON.stringify({ ok: false, error: "spec 不能为空" })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "无产品定义" })); return; }
      const slug = String(body.slug ?? "").trim() || productSlug(session.idea);
      await snapshotLoop(repoRoot, slug, "spec 保存前自动存", Date.now()).catch(() => {});
      await writeSpec(repoRoot, slug, spec);
      res.end(JSON.stringify({ ok: true, note: "spec 已保存" }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/accept",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const stage = String(body.stage ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "无产品定义" })); return; }
      const slug = String(body.slug ?? "").trim() || productSlug(session.idea);
      const state = await readLoopState(repoRoot, slug);
      if (!state) { res.end(JSON.stringify({ ok: false, error: "尚无阶段状态，请先完成访谈" })); return; }
      if (!isProductStage(stage)) {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: "非法产品阶段" }));
        return;
      }
      const stageDecision = canAcceptStage(state, stage);
      if (!stageDecision.ok) {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: stageDecision.reason }));
        return;
      }
      if (stage === "spec") {
        const decision = decideSpecAcceptance({
          concreteness: assessConcreteness(session.definition),
          humanOverride: body.humanOverride === true,
        });
        if (!decision.allowed) {
          res.statusCode = 409;
          res.end(JSON.stringify({
            ok: false,
            error: decision.message,
            blockedFields: decision.blockedFields,
          }));
          return;
        }
        if (decision.overridden) {
          void appendAudit(context.stateDir, {
            at: Date.now(),
            action: "product-accept-override",
            user: currentUsername(),
            path: "/api/product/accept",
          });
        }
      }
      const st = await acceptStageWithCheckpoint(repoRoot, slug, stage, session.definition, Date.now());
      if (!st) { res.end(JSON.stringify({ ok: false, error: "尚无阶段状态，请先完成访谈" })); return; }
      let env: EnvCheck | undefined;
      let launched: boolean | undefined;
      // design 接受 → agent 起草 build-spec（机器起草下一份产物，人随后精修）
      if (stage === "design") {
        const reg = await readProductRegistry(repoRoot);
        const entry = reg.products.find((product) => product.slug === slug);
        const template = entry?.template ? templateById(entry.template) : undefined;
        const conventions = [templateConventionsBlock(template), templateObjectsBlock(template)].filter(Boolean).join("\n\n");
        await draftBuildSpec(repoRoot, slug, new CliRunner(), Date.now(), { conventions });
      }
      // build 接受 → 后台跑 kunpeng plan 拆 flow（flow 见开发流 tab）
      if (stage === "build") {
        try {
          env = await envPreflight(repoRoot);
        } catch (e) { console.error(`[product] envPreflight 失败 slug=${slug}:`, String(e)); }
        const ws = await ensureWorkspace(repoRoot, slug);
        if (session.definition) await writeGrowthFiles(repoRoot, slug, session.definition).catch(() => []);
        await registerProject({
          repoPath: ws,
          name: `产品·${slug}`,
          stateDir: kunpengStateDir(),
          now: Date.now(),
        }).catch(() => {});
        if (context.execPath && context.cliJs) {
          const buildSpecPath = join(productLoopDir(repoRoot, slug), "build-spec.md");
          launchKunpeng(
            { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
            planArgs(buildSpecPath, ws),
            ws,
          );
          launched = true;
        } else {
          launched = false;
        }
        try {
          await createTaskBatchForBuild(repoRoot, slug, session.idea, session.definition, Date.now());
        } catch (e) { console.error(`[product] createTaskBatchForBuild 失败 slug=${slug}（任务卡未生成）:`, String(e)); }
      }
      res.end(JSON.stringify({ ok: true, currentStage: st.currentStage, ...(env ? { env } : {}), ...(launched === undefined ? {} : { launched }) }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/buildspec/save",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const md = String(body.buildSpec ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "无产品定义" })); return; }
      await writeBuildSpec(repoRoot, productSlug(session.idea), md);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/design/run",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    if (!context.execPath || !context.cliJs) { res.end(JSON.stringify({ ok: false, error: "启动器未配置" })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "无产品定义" })); return; }
      const slug = String(body.slug ?? "").trim() || productSlug(session.idea);
      if (body.brief && typeof body.brief === "object") {
        await writeBrief(repoRoot, slug, body.brief as DesignBrief);
      }
      const brief = await readBrief(repoRoot, slug);
      if (!brief) { res.end(JSON.stringify({ ok: false, error: "尚无 BRIEF，请先接受 spec" })); return; }
      const briefDir = join(repoRoot, ".kunpeng", "cockpit", "design-briefs");
      await mkdir(briefDir, { recursive: true });
      const briefPath = join(briefDir, `${slug}-${Date.now().toString(36)}.json`);
      await writeFile(briefPath, JSON.stringify(brief), "utf8");
      const outDir = join(repoRoot, ".kunpeng", "design-out", slug);
      const { pid, logPath } = launchKunpeng(
        { execPath: context.execPath, cliJs: context.cliJs, spawn: context.spawn },
        designGenerateArgs(briefPath, outDir, repoRoot, { rounds: 2 }),
        repoRoot,
      );
      res.end(JSON.stringify({ ok: true, pid, logPath, outDir, note: `已后台生成设计预览，产物落 ${outDir}` }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/product/validate",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    res.setHeader("content-type", "application/json");
    const repoRoot = await resolveRepo(context, projectId);
    if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
    try {
      const session = await readInterview(repoRoot);
      if (!session?.definition) { res.end(JSON.stringify({ ok: false, error: "无产品定义" })); return; }
      const slug = productSlug(session.idea);
      // 构造最小 ShapedPitch（用 session.definition）
      const pitch = {
        title: session.definition.idea,
        appetite: "",
        problem: session.definition.problem,
        solution: "",
        buildScope: [],
        rabbitHoles: [],
        noGos: [],
        successMetrics: [],
      };
      // 映射 signals，缺字段补默认
      const rawSignals = Array.isArray(body.signals) ? body.signals : [];
      const signals = (rawSignals as Array<Record<string, unknown>>).map((s) => ({
        source: typeof s.source === "string" ? s.source : "unknown",
        kind: typeof s.kind === "string" ? s.kind : "other",
        summary: typeof s.summary === "string" ? s.summary : "",
        synthetic: typeof s.synthetic === "boolean" ? s.synthetic : false,
      })) as import("../../product/contract.js").ProductValidationSignal[];
      const hypotheses = Array.isArray(body.hypotheses) ? (body.hypotheses as unknown[]).map(String) : [];
      const decision = typeof body.decision === "string" ? body.decision as import("../../product/contract.js").ProductValidationDecision : undefined;
      const rationale = typeof body.rationale === "string" ? body.rationale : undefined;
      const r = await recordAndClose(repoRoot, slug, { pitch, hypotheses, signals, decision, rationale }, Date.now());
      if (!r) { res.end(JSON.stringify({ ok: false, error: "尚无阶段状态，请先完成 validate 阶段" })); return; }
      // pivot → 全自动重生下游
      if (r.iteration.action === "pivot" && r.iteration.nextSeed) {
        await applyPivot(repoRoot, slug, r.iteration.nextSeed, new CliRunner(), Date.now());
      }
      // ADR best-effort
      try {
        const adrSections = validationAdrSections(r.validation, r.iteration, pitch);
        if (adrSections) {
          const adrDir = join(repoRoot, "docs", "decisions");
          await mkdir(adrDir, { recursive: true });
          let adrFiles: string[] = [];
          try { adrFiles = await readdir(adrDir); } catch { adrFiles = []; }
          const adrNum = nextAdrNumber(adrFiles);
          const adrDate = new Date().toISOString().slice(0, 10);
          const adrFname = adrFilename(adrNum, adrSections.title);
          const adrContent = renderFilledAdr(adrNum, adrSections.title, { status: adrSections.status, dateISO: adrDate }, adrSections);
          await writeFile(join(adrDir, adrFname), adrContent, "utf8");
        }
      } catch (e) { console.warn("[validate] adr skip", e); }
      // KB best-effort
      try {
        const kbText = `产品验证裁定：${r.validation.decision}。假设：${r.validation.hypotheses.join("；") || "(无)"}。原因：${r.validation.rationale}。下一步：${r.iteration.action}。`;
        const kbStore = new CaptureStore(resolveCapturesDir(repoRoot));
        await kbStore.appendCapture({
          id: `val-${Date.now().toString(36)}-${slug}`,
          source: "text",
          kind: "text",
          raw: kbText,
          title: `验证裁定 ${r.validation.decision} — ${pitch.title}`,
          summary: kbText,
          tags: ["产品验证", r.validation.decision, slug],
          category: "产品",
          projectId,
          citedFrom: "validate-endpoint",
          createdAt: Date.now(),
          promoted: false,
        });
      } catch (e) { console.warn("[validate] kb skip", e); }
      res.end(JSON.stringify({ ok: true, iteration: r.iteration, validation: r.validation }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  },
});
