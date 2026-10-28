import { isRecord } from "../util/is-record.js";
import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { readInterview } from "../product/store.js";
import { loadLoopView } from "../product/loop-orchestrate.js";
import { productSlug } from "../product/artifacts.js";
import { isValidProductSlug } from "../product/slug-guard.js";
import { currentQuestion } from "../product/interview.js";
import { INTERVIEW_QUESTIONS } from "../product/contract.js";
import type { DesignCandidatePreview, DesignVerdictView, ProductSessionView } from "./state-types.js";

/** 读 .kunpeng/previews/candidates.json（design-preview 生成）；缺失/坏档返回空。 */
export async function readDesignCandidates(repoRoot: string): Promise<DesignCandidatePreview[]> {
  try {
    const raw = await readFile(join(repoRoot, ".kunpeng", "previews", "candidates.json"), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function boolOrFalse(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

/** 读 design-codegen tier-gate 裁决；缺失/坏档/关键字段缺失返回 undefined。 */
export async function readDesignVerdict(repoRoot: string): Promise<DesignVerdictView | undefined> {
  try {
    const raw = await readFile(join(repoRoot, ".kunpeng", "design-code", "tier-gate.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.decision) || !isRecord(parsed.input)) return undefined;

    const { decision, input } = parsed;
    return {
      tier1AutoPass: boolOrFalse(decision.tier1AutoPass),
      needsHumanReview: boolOrFalse(decision.needsHumanReview),
      blockers: Array.isArray(decision.blockers) ? decision.blockers.filter((b): b is string => typeof b === "string") : [],
      a11yGateable: boolOrFalse(input.a11yGateable),
      perfWithinBudget: boolOrFalse(input.perfWithinBudget),
      visualMatchesBaseline: boolOrFalse(input.visualMatchesBaseline),
      hasNewOrChangedBaseline: boolOrFalse(input.hasNewOrChangedBaseline),
    };
  } catch {
    return undefined;
  }
}

export async function readProductSessionView(repoRoot: string): Promise<ProductSessionView | undefined> {
  const session = await readInterview(repoRoot);
  if (!session) return undefined;
  const loop = session.definition ? await loadLoopView(repoRoot, productSlug(session.idea)) : undefined;
  return {
    status: session.status,
    idea: session.idea,
    answeredCount: session.answers.length,
    totalQuestions: INTERVIEW_QUESTIONS.length,
    currentQuestion: currentQuestion(session),
    definition: session.definition,
    loop,
  };
}

export async function readProductSessionViewForSlug(repoRoot: string, slug: string): Promise<ProductSessionView | undefined> {
  if (!isValidProductSlug(slug)) return undefined;
  const tombstone = join(repoRoot, ".kunpeng", "product", slug, "tombstone.json");
  if (await access(tombstone).then(() => true).catch(() => false)) return undefined;
  const session = await readInterview(repoRoot);
  if (session?.definition && productSlug(session.idea) === slug) {
    return readProductSessionView(repoRoot);
  }
  const loop = await loadLoopView(repoRoot, slug);
  if (!loop) return undefined;
  return {
    status: "done",
    idea: slug,
    answeredCount: 0,
    totalQuestions: INTERVIEW_QUESTIONS.length,
    definition: { problem: "（从既有产物导入，定义待补全）", idea: slug, users: [], stories: [], acceptance: [] },
    loop,
  };
}
