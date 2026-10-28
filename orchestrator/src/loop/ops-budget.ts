import { isRecord } from "../util/is-record.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Budget } from "../runtime/cost-budget.js";
import { budgetHalt, type BudgetHalt } from "../runtime/run-budget.js";

function positive(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function resolveOpsBudget(env: Record<string, string | undefined>): Budget {
  const budget: Budget = {};
  const maxTokens = positive(env.KUNPENG_OPS_TOKEN_BUDGET);
  if (maxTokens !== undefined) budget.maxTokens = maxTokens;
  return budget;
}

function monthBoundsUtc(now: number): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

export function opsSpentTokensThisMonth(stateDir: string, now: number): number {
  const { start, end } = monthBoundsUtc(now);
  let total = 0;
  let names: string[];
  try {
    names = readdirSync(stateDir);
  } catch {
    return 0;
  }

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(stateDir, name), "utf8"));
      if (!isRecord(parsed)) continue;
      if (typeof parsed.flowId !== "string" || !parsed.flowId.startsWith("loop-")) continue;
      if (typeof parsed.updatedAt !== "number" || parsed.updatedAt < start || parsed.updatedAt >= end) continue;
      total += typeof parsed.tokensUsed === "number" && Number.isFinite(parsed.tokensUsed) ? parsed.tokensUsed : 0;
    } catch {
      continue;
    }
  }
  return total;
}

export function gateLoopWaveByBudget(
  stateDir: string,
  env: Record<string, string | undefined>,
  now: number,
): BudgetHalt {
  const budget = resolveOpsBudget(env);
  const spent = opsSpentTokensThisMonth(stateDir, now);
  return budgetHalt(spent, 0, budget);
}
