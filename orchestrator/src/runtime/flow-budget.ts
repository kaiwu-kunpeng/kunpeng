import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateCostUsd } from "./cost-pricing.js";
import { flowUsdStageMix, type FlowUsdLike } from "./flow-cost.js";

export const DEFAULT_FLOW_USD_BUDGET = 8;

export interface FlowBudget {
  maxTokens?: number;
  maxMs?: number;
  maxUsd?: number;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveFlowBudget(env: Record<string, string | undefined>): FlowBudget {
  const budget: FlowBudget = {};
  const maxTokens = finiteNumber(env.KUNPENG_FLOW_TOKEN_BUDGET);
  const maxMs = finiteNumber(env.KUNPENG_FLOW_MS_BUDGET);
  const usdSetting = env.KUNPENG_FLOW_USD_BUDGET?.trim().toLowerCase();
  const maxUsd = usdSetting === undefined
    ? DEFAULT_FLOW_USD_BUDGET
    : finiteNumber(usdSetting);

  if (maxTokens !== undefined) budget.maxTokens = maxTokens;
  if (maxMs !== undefined) budget.maxMs = maxMs;
  if (maxUsd !== undefined) budget.maxUsd = maxUsd;
  return budget;
}

export interface FlowSpend {
  tokens: number;
  elapsedMs: number;
  model?: string;
  usd?: number;
}

export interface FlowBudgetVerdict {
  level: "ok" | "warn50" | "warn80" | "halt";
  reason: string;
  ratios: { tokens?: number; ms?: number; usd?: number; dayUsd?: number; monthUsd?: number };
}

type BudgetDimension = "tokens" | "ms" | "usd" | "day-usd" | "month-usd";

interface DimensionRatio {
  dimension: BudgetDimension;
  ratio: number;
}

function ratio(spent: number, limit: number): number {
  if (limit === 0) return spent === 0 ? 0 : spent > 0 ? Infinity : -Infinity;
  return spent / limit;
}

function percentage(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : value < 0 ? "-Infinity" : "NaN";
  return String(Math.round(value * 100));
}

export function checkFlowBudget(spend: FlowSpend, budget: FlowBudget): FlowBudgetVerdict {
  const ratios: FlowBudgetVerdict["ratios"] = {};
  const dimensions: DimensionRatio[] = [];

  if (budget.maxTokens !== undefined) {
    ratios.tokens = ratio(spend.tokens, budget.maxTokens);
    dimensions.push({ dimension: "tokens", ratio: ratios.tokens });
  }
  if (budget.maxMs !== undefined) {
    ratios.ms = ratio(spend.elapsedMs, budget.maxMs);
    dimensions.push({ dimension: "ms", ratio: ratios.ms });
  }
  if (budget.maxUsd !== undefined) {
    const model = spend.model ?? "unknown";
    const spentUsd = typeof spend.usd === "number" && Number.isFinite(spend.usd)
      ? spend.usd
      : estimateCostUsd({ [model]: spend.tokens }).totalUsd;
    ratios.usd = ratio(spentUsd, budget.maxUsd);
    dimensions.push({ dimension: "usd", ratio: ratios.usd });
  }

  return budgetVerdict(dimensions, ratios);
}

function budgetVerdict(dimensions: DimensionRatio[], ratios: FlowBudgetVerdict["ratios"]): FlowBudgetVerdict {
  if (dimensions.length === 0) {
    return { level: "ok", reason: "budget-ok: no-limits", ratios };
  }

  const highest = dimensions.reduce((current, candidate) =>
    candidate.ratio > current.ratio ? candidate : current,
  );
  const percent = percentage(highest.ratio);

  if (highest.ratio >= 1) {
    return {
      level: "halt",
      reason: `budget-exceeded: ${highest.dimension} ${percent}%`,
      ratios,
    };
  }
  if (highest.ratio >= 0.8) {
    return {
      level: "warn80",
      reason: `budget-warning: ${highest.dimension} ${percent}%`,
      ratios,
    };
  }
  if (highest.ratio >= 0.5) {
    return {
      level: "warn50",
      reason: `budget-warning: ${highest.dimension} ${percent}%`,
      ratios,
    };
  }
  return {
    level: "ok",
    reason: `budget-ok: ${highest.dimension} ${percent}%`,
    ratios,
  };
}

export interface RepoBudget {
  dailyUsd?: number;
  monthlyUsd?: number;
  maxConcurrent?: number;
}

export function repoBudgetPath(kunpengDir: string): string {
  return join(kunpengDir, "budget.json");
}

export function loadRepoBudget(kunpengDir: string): RepoBudget {
  try {
    const value: unknown = JSON.parse(readFileSync(repoBudgetPath(kunpengDir), "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const budget: RepoBudget = {};
    for (const key of ["dailyUsd", "monthlyUsd", "maxConcurrent"] as const) {
      const limit = record[key];
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) continue;
      if (key === "maxConcurrent" && !Number.isInteger(limit)) continue;
      budget[key] = limit;
    }
    return budget;
  } catch {
    return {};
  }
}

export function repoSpentUsd(
  flows: readonly (FlowUsdLike & { updatedAt?: number })[],
  now: number,
): { dayUsd: number; monthUsd: number } {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1);
  const monthEnd = Date.UTC(year, month + 1, 1);
  const dayStart = Date.UTC(year, month, date.getUTCDate());
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  let dayUsd = 0;
  let monthUsd = 0;
  for (const flow of flows) {
    const at = flow.updatedAt;
    if (at === undefined || !Number.isFinite(at) || at < monthStart || at >= monthEnd) continue;
    const usd = flowUsdStageMix(flow);
    monthUsd += usd;
    if (at >= dayStart && at < dayEnd) dayUsd += usd;
  }
  return { dayUsd: Math.round(dayUsd * 10000) / 10000, monthUsd: Math.round(monthUsd * 10000) / 10000 };
}

export function checkRepoBudget(spent: { dayUsd: number; monthUsd: number }, budget: RepoBudget): FlowBudgetVerdict {
  const ratios: FlowBudgetVerdict["ratios"] = {};
  const dimensions: DimensionRatio[] = [];
  if (budget.dailyUsd !== undefined) {
    ratios.dayUsd = ratio(spent.dayUsd, budget.dailyUsd);
    dimensions.push({ dimension: "day-usd", ratio: ratios.dayUsd });
  }
  if (budget.monthlyUsd !== undefined) {
    ratios.monthUsd = ratio(spent.monthUsd, budget.monthlyUsd);
    dimensions.push({ dimension: "month-usd", ratio: ratios.monthUsd });
  }
  return budgetVerdict(dimensions, ratios);
}
