import { readFileSync } from "node:fs";
import { estimateCostUsd } from "../runtime/cost-pricing.js";
import type { ReviewItem } from "./state.js";

export interface CostBudget {
  maxUsd?: number;
  maxTokens?: number;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function loadCostBudget(path: string): CostBudget | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const maxUsd = positiveFiniteNumber(record.maxUsd);
    const maxTokens = positiveFiniteNumber(record.maxTokens);
    if (maxUsd === undefined && maxTokens === undefined) return null;

    return {
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  } catch {
    return null;
  }
}

export function budgetReviewItem(totalTokens: number, budget: CostBudget | null, totalUsd?: number): ReviewItem | null {
  if (budget === null) return null;

  const maxUsd = positiveFiniteNumber(budget.maxUsd);
  const maxTokens = positiveFiniteNumber(budget.maxTokens);
  if (maxUsd === undefined && maxTokens === undefined) return null;

  const usd = typeof totalUsd === "number" && Number.isFinite(totalUsd) && totalUsd >= 0
    ? totalUsd
    : estimateCostUsd({ default: totalTokens }).totalUsd;
  const ratio = Math.max(
    maxTokens !== undefined ? totalTokens / maxTokens : 0,
    maxUsd !== undefined ? usd / maxUsd : 0,
  );
  if (ratio < 0.8) return null;

  return {
    projectId: "__budget__",
    projectName: "成本",
    kind: "budget",
    id: "budget",
    title: ratio >= 1 ? "成本超预算" : "成本接近预算",
    detail: `已用 ${totalTokens} tokens ≈ $${usd.toFixed(2)}`
      + (maxUsd !== undefined ? ` / 预算 $${maxUsd}` : "")
      + (maxTokens !== undefined ? ` / 上限 ${maxTokens} tokens` : "")
      + `（${Math.round(ratio * 100)}%）`,
  };
}
