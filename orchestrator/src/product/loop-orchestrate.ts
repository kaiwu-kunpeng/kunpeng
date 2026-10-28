// 产品轨阶段推进的纯编排（IO 经 loop-store；无 HTTP）。handler 调这里，便于测试。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignBrief } from "../design/brief-gate.js";
import type { AgentRunner } from "../agent/runner.js";
import { CaptureStore, newCapture, resolveCapturesDir } from "../knowledge/capture-store.js";
import { productSlug } from "./artifacts.js";
import type {
  ProductDefinition,
  ProductIteration,
  ProductValidation,
  ProductValidationDecision,
  ProductValidationSignal,
  ShapedPitch,
} from "./contract.js";
import {
  productLoopDir,
  readBrief,
  readBuildSpec,
  readLoopState,
  readSpec,
  readValidation,
  writeBrief,
  writeBuildSpec,
  writeLoopState,
  writeSpec,
  writeValidation,
} from "./loop-store.js";
import { recordValidation } from "./validation-record.js";
import { autoDefineProduct } from "./auto-define.js";
import { specToBrief } from "./spec-to-brief.js";
import { parseSpecBriefFields } from "./spec-parse.js";
import { specToBuildSpec } from "./spec-to-buildspec.js";
import { acceptStage, draftStage, initState, resetToStage, type ProductLoopState, type ProductStage } from "./stage-machine.js";
import { definitionToSpec } from "./to-spec.js";
import { createProduct } from "./registry-service.js";
import { templateById } from "./product-templates.js";
import { currentQuestion, startInterview } from "./interview.js";
import { writeInterview } from "./store.js";
import { snapshotLoop } from "./loop-checkpoint.js";
import { readPreview, type PreviewInfo } from "./preview.js";
import { readPreviewErrors } from "./preview-errors.js";
import { readPublish, type PublishRecord } from "./publish.js";
import { readRecentPicks, type ProductPick } from "./ops-kit.js";
import { listWorkspaceVersions } from "./workspace.js";

type ProductEntry = Awaited<ReturnType<typeof createProduct>>;

export async function startProductRun(
  repoRoot: string,
  idea: string,
  now: number,
  templateId?: string,
): Promise<{ product: ProductEntry; question?: string; note: string }> {
  const product = await createProduct(repoRoot, idea, now, undefined, templateId);
  if (templateId && templateById(templateId) && !product.template) {
    product.template = templateId;
  }
  const session = startInterview(idea);
  await writeInterview(repoRoot, session);
  return { product, question: currentQuestion(session), note: "已启动 DEFINE 访谈" };
}

/** 访谈完成后自动起草 spec：写 spec.md + 建/推进状态机到 spec:drafted。返回 slug。 */
export async function draftSpecForDefinition(
  repoRoot: string,
  def: ProductDefinition,
  now: number,
): Promise<string> {
  const slug = productSlug(def.idea);
  await writeSpec(repoRoot, slug, definitionToSpec(def));
  const base = (await readLoopState(repoRoot, slug)) ?? initState(slug, def.idea, now);
  const specPath = join(productLoopDir(repoRoot, slug), "spec.md");
  await writeLoopState(repoRoot, draftStage(base, "spec", specPath, now));
  return slug;
}

/** 接受当前阶段并推进。spec 被接受 → 自动推导 brief + 起草 design。 */
export async function acceptAndAdvance(
  repoRoot: string,
  slug: string,
  stage: ProductStage,
  def: ProductDefinition,
  now: number,
): Promise<ProductLoopState | undefined> {
  const cur = await readLoopState(repoRoot, slug);
  if (!cur) return undefined;
  let next = acceptStage(cur, stage, now);
  if (stage === "spec") {
    const spec = await readSpec(repoRoot, slug);
    const parsed = spec?.trim() ? parseSpecBriefFields(spec) : {};
    const effectiveDef = Object.keys(parsed).length > 0 ? { ...def, ...parsed } : def;
    await writeBrief(repoRoot, slug, specToBrief(effectiveDef));
    const briefPath = join(productLoopDir(repoRoot, slug), "brief.json");
    next = draftStage(next, "design", briefPath, now);
  }
  await writeLoopState(repoRoot, next);
  return next;
}

export async function acceptStageWithCheckpoint(
  repoRoot: string,
  slug: string,
  stage: ProductStage,
  def: ProductDefinition,
  now: number,
): Promise<ProductLoopState | undefined> {
  try {
    await snapshotLoop(repoRoot, slug, `接受${stage}前自动存`, now);
  } catch (e) {
    console.warn(`[product-loop] 自动快照失败（流程继续）：${slug}/${stage} — ${String(e)}`);
  }
  return acceptAndAdvance(repoRoot, slug, stage, def, now);
}

export interface LoopView extends ProductLoopState {
  spec?: string;
  brief?: DesignBrief;
  buildSpec?: string;
  validation?: ProductValidation;
  preview?: PreviewInfo & { alive: boolean };
  previewErrors?: string[];
  publish?: PublishRecord;
  qa?: { ok: boolean; problems: string[]; at?: number; screenshotPath?: string };
  picks?: ProductPick[];
  workspaceVersions?: Array<{ sha: string; message: string; at: number }>;
}

async function readQa(repoRoot: string, slug: string): Promise<LoopView["qa"]> {
  try {
    return JSON.parse(await readFile(join(productLoopDir(repoRoot, slug), "qa.json"), "utf8")) as LoopView["qa"];
  } catch {
    return undefined;
  }
}

function signalField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() === "" ? undefined : `${key}=${value}`;
  if (typeof value === "number" || typeof value === "boolean") return `${key}=${String(value)}`;
  return undefined;
}

function validationSignalLine(signal: ProductValidationSignal): string {
  if (typeof signal !== "object" || signal === null || Array.isArray(signal)) return "- (无法读取信号)";
  const record = signal as unknown as Record<string, unknown>;
  const parts = ["source", "kind", "summary", "note", "at", "synthetic"]
    .map((key) => signalField(record, key))
    .filter((value): value is string => value !== undefined);
  return `- ${parts.length > 0 ? parts.join("；") : "(无法读取信号)"}`;
}

function validationCaptureRaw(
  slug: string,
  input: { hypotheses: string[]; signals: ProductValidationSignal[] },
  validation: ProductValidation,
  iteration: ProductIteration,
): string {
  const hypotheses = input.hypotheses.length > 0
    ? input.hypotheses.map((hypothesis) => `- ${hypothesis}`).join("\n")
    : "- (未列)";
  const signals = input.signals.length > 0
    ? input.signals.map((signal) => validationSignalLine(signal)).join("\n")
    : "- (无)";

  return [
    `# 产品验证：${slug}`,
    "",
    "**假设列表**",
    hypotheses,
    "",
    "**信号摘要**",
    signals,
    "",
    "**裁决**",
    `${validation.decision}：${validation.rationale}`,
    "",
    "**闭环动作**",
    iteration.action,
  ].join("\n");
}

/** 合并状态机 + spec + brief + buildSpec + validation + preview/publish/qa 供 UI 渲染。 */
export async function loadLoopView(repoRoot: string, slug: string): Promise<LoopView | undefined> {
  const state = await readLoopState(repoRoot, slug);
  if (!state) return undefined;
  const preview = await readPreview(repoRoot, slug);
  let previewErrors: string[] | undefined;
  if (preview?.alive) {
    try {
      previewErrors = await readPreviewErrors(repoRoot, slug);
    } catch {
      previewErrors = undefined;
    }
  }
  const picks = await readRecentPicks(repoRoot, slug);
  const workspaceVersions = await listWorkspaceVersions(repoRoot, slug, 10);
  return {
    ...state,
    spec: await readSpec(repoRoot, slug),
    brief: await readBrief(repoRoot, slug),
    buildSpec: await readBuildSpec(repoRoot, slug),
    validation: await readValidation(repoRoot, slug),
    preview,
    previewErrors,
    publish: await readPublish(repoRoot, slug),
    qa: await readQa(repoRoot, slug),
    ...(picks.length > 0 ? { picks } : {}),
    ...(workspaceVersions.length > 0 ? { workspaceVersions } : {}),
  };
}

/** design 接受后：读 spec.md → agent 起草 build-spec.md → 推进状态机到 build:drafted。 */
export async function draftBuildSpec(
  repoRoot: string,
  slug: string,
  runner: AgentRunner,
  now: number,
  opts?: { conventions?: string },
): Promise<ProductLoopState | undefined> {
  const cur = await readLoopState(repoRoot, slug);
  if (!cur) return undefined;
  const spec = await readSpec(repoRoot, slug);
  if (!spec) return undefined;
  const md = await specToBuildSpec(spec, runner, opts);
  await writeBuildSpec(repoRoot, slug, md);
  const buildSpecPath = join(productLoopDir(repoRoot, slug), "build-spec.md");
  const next = draftStage(cur, "build", buildSpecPath, now);
  await writeLoopState(repoRoot, next);
  return next;
}

/** validate 阶段:录入信号→裁定→闭环动作。写 validation.json。persevere→validate:accepted。返回 iteration。 */
export async function recordAndClose(
  repoRoot: string,
  slug: string,
  input: { pitch: ShapedPitch; hypotheses: string[]; signals: ProductValidationSignal[]; decision?: ProductValidationDecision; rationale?: string },
  now: number,
): Promise<{ validation: ProductValidation; iteration: ProductIteration } | undefined> {
  const cur = await readLoopState(repoRoot, slug);
  if (!cur) return undefined;
  const { validation, iteration } = recordValidation(input);
  await writeValidation(repoRoot, slug, validation);
  try {
    const raw = validationCaptureRaw(slug, input, validation, iteration);
    const summary = `裁决 ${validation.decision}：${validation.rationale}`;
    const store = new CaptureStore(resolveCapturesDir(repoRoot));
    const capture = newCapture(
      {
        source: "text",
        kind: "product-validation",
        raw,
        title: `产品验证：${slug}`,
        summary,
        tags: ["product", "validate", slug],
      },
      {
        now: () => now,
        id: () => `product-validate-${now.toString(36)}-${randomUUID().slice(0, 8)}`,
      },
    );
    await store.appendCapture(capture);
  } catch (e) {
    console.warn(`[product-loop] 验证 capture 写入失败（流程继续）：${slug} — ${String(e)}`);
  }
  if (iteration.action === "build") {
    await writeLoopState(repoRoot, acceptStage(cur, "validate", now));
  }
  return { validation, iteration };
}

/** pivot:用 nextSeed 全自动重生 spec→brief→build-spec,拨回 build:drafted 给人最后审。 */
export async function applyPivot(
  repoRoot: string,
  slug: string,
  nextSeed: string,
  runner: AgentRunner,
  now: number,
): Promise<ProductLoopState | undefined> {
  const cur = await readLoopState(repoRoot, slug);
  if (!cur) return undefined;
  await snapshotLoop(repoRoot, slug, "pivot 前自动存", now).catch(() => {});
  const def = await autoDefineProduct(nextSeed, runner);
  const spec = definitionToSpec(def);
  const brief = specToBrief(def);
  const buildSpec = await specToBuildSpec(spec, runner);
  const buildSpecPath = join(productLoopDir(repoRoot, slug), "build-spec.md");
  const next = resetToStage(cur, "build", buildSpecPath, now);
  await writeSpec(repoRoot, slug, spec);
  await writeBrief(repoRoot, slug, brief);
  await writeBuildSpec(repoRoot, slug, buildSpec);
  await writeLoopState(repoRoot, next);
  return next;
}
