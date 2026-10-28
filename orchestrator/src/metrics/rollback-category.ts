// 回滚归因第二层：细粒度 kind → 固定类别，并统计 unknown 占比作为 harness 可观测性指标。
import { classifyFailureText, type RollbackKind } from "../loop/rollback-attribution.js";
import type { FlowState } from "../runtime/flowstate.js";

export const ROLLBACK_CATEGORIES = ["spec-defect", "gate-defect", "env-defect", "implement-failed", "timeout", "abandoned", "unknown"] as const;
export type RollbackCategory = (typeof ROLLBACK_CATEGORIES)[number];

/** 每个 kind 必有归属；verify-evaluator 还需区分评估器判不定与实现失败。 */
export const KIND_CATEGORY: Record<RollbackKind, RollbackCategory> = {
  "transform-error": "implement-failed", typecheck: "implement-failed", "test-failed": "implement-failed", lint: "implement-failed",
  "check-regression": "implement-failed", "empty-diff": "implement-failed", "anchor-missing": "implement-failed",
  "scope-gate": "implement-failed", "eval-tamper": "implement-failed", "loop-wave-unverified": "implement-failed", "verify-evaluator": "implement-failed",
  "no-accept-cmd": "spec-defect", "not-red-first": "spec-defect", "audit-rejected": "spec-defect", "spec-blocker": "spec-defect",
  "worktree-contention": "env-defect", crashed: "env-defect", "garbage-spec": "env-defect", "dispatch-slot-timeout": "env-defect",
  timeout: "timeout", "stage-timeout": "timeout",
  abandoned: "abandoned", unknown: "unknown",
};

const EVALUATOR_GATE_DEFECT = /inconclusive|不可解析|无法判定/;
/** 后端单次调用 600s 硬杀：以相邻 history 条目的间隔窄带推断。 */
export const STAGE_TIMEOUT_BAND_MS: readonly [number, number] = [590_000, 620_000];

export function categorizeKind(kind: string, summary = ""): RollbackCategory {
  if (kind === "verify-evaluator") return EVALUATOR_GATE_DEFECT.test(summary) ? "gate-defect" : "implement-failed";
  return Object.hasOwn(KIND_CATEGORY, kind) ? KIND_CATEGORY[kind as RollbackKind] : "unknown";
}

export interface FlowRollbackAttribution {
  kind: string;
  category: RollbackCategory;
  summary: string;
  /** rollback=流内落账；text=失败文本；history=历史结构推断；none=无可归因信号。 */
  signal: "rollback" | "text" | "history" | "none";
}

export function hasStageTimeout(history: readonly { stage: string; at: number }[]): boolean {
  for (let i = 1; i < history.length; i++) {
    const gap = history[i]!.at - history[i - 1]!.at;
    if (gap >= STAGE_TIMEOUT_BAND_MS[0] && gap <= STAGE_TIMEOUT_BAND_MS[1]) return true;
  }
  return false;
}

/** 优先级：结构化 rollback → 失败文本 → history crashed → 600s 阶段 → unknown。 */
export function attributeFlow(flow: Pick<FlowState, "rollback" | "failureReason" | "blocker" | "history">): FlowRollbackAttribution {
  if (flow.rollback?.kind) {
    return { kind: flow.rollback.kind, category: categorizeKind(flow.rollback.kind, flow.rollback.summary), summary: flow.rollback.summary, signal: "rollback" };
  }
  const text = [flow.failureReason, flow.blocker].find((t) => typeof t === "string" && t.trim() !== "") ?? "";
  if (text.trim() !== "") {
    const { kind, summary } = classifyFailureText(text);
    if (kind !== "unknown") return { kind, category: categorizeKind(kind, summary), summary, signal: "text" };
  }
  if (flow.history.some((entry) => entry.stage === "crashed")) {
    return { kind: "crashed", category: "env-defect", summary: "history 含 crashed 阶段", signal: "history" };
  }
  if (hasStageTimeout(flow.history)) {
    return { kind: "stage-timeout", category: "timeout", summary: "某阶段恰跑满 600s 被硬杀", signal: "history" };
  }
  return { kind: "unknown", category: "unknown", summary: text.trim() === "" ? "" : classifyFailureText(text).summary, signal: "none" };
}

export interface RollbackCategoryStats {
  total: number;
  byCategory: Record<RollbackCategory, number>;
  byKind: Record<string, number>;
  bySignal: Record<FlowRollbackAttribution["signal"], number>;
  /** unknown 占比（%，一位小数）；越低，可归因覆盖越完整。 */
  unknownPct: number;
}

export const ROLLBACK_STATS_STATUSES = ["rolled-back", "crashed"] as const;

export function buildRollbackCategoryStats(
  flows: readonly Pick<FlowState, "status" | "updatedAt" | "rollback" | "failureReason" | "blocker" | "history">[],
  window: { sinceMs: number; untilMs: number },
): RollbackCategoryStats {
  const byCategory = Object.fromEntries(ROLLBACK_CATEGORIES.map((c) => [c, 0])) as Record<RollbackCategory, number>;
  const byKind = Object.create(null) as Record<string, number>;
  const bySignal: RollbackCategoryStats["bySignal"] = { rollback: 0, text: 0, history: 0, none: 0 };
  let total = 0;
  for (const flow of flows) {
    if (!ROLLBACK_STATS_STATUSES.some((s) => s === flow.status)) continue;
    if (!(window.sinceMs <= flow.updatedAt && flow.updatedAt < window.untilMs)) continue;
    const a = attributeFlow(flow);
    total++;
    byCategory[a.category]++;
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    bySignal[a.signal]++;
  }
  return { total, byCategory, byKind, bySignal, unknownPct: total === 0 ? 0 : Math.round(byCategory.unknown / total * 1000) / 10 };
}

export function formatRollbackCategoryReport(stats: RollbackCategoryStats): string {
  const cats = ROLLBACK_CATEGORIES.map((c) => `${c} ${stats.byCategory[c]}`).join("；");
  const kinds = Object.entries(stats.byKind).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k}=${n}`).join(" ");
  return [
    `【回滚归因】窗口内回滚/崩溃 ${stats.total} 条 · unknown 占比 ${stats.unknownPct}%（harness 可观测性指标，越低越好）`,
    `按归因：${cats}`,
    `按细类：${kinds || "无"}`,
    `信号来源：流内落账 ${stats.bySignal.rollback}；失败文本 ${stats.bySignal.text}；history 结构 ${stats.bySignal.history}；无信号 ${stats.bySignal.none}`,
  ].join("\n");
}
