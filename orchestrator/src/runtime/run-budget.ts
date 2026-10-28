import { checkBudget, type Budget, type BudgetStatus } from "./cost-budget.js";
import { flowsUsdStageMix, type FlowUsdLike } from "./flow-cost.js";

export function sumFlowUsd(flows: readonly FlowUsdLike[]): number {
  return flowsUsdStageMix(flows);
}

/** 从环境变量解析单次 run 预算:KUNPENG_RUN_TOKEN_BUDGET / KUNPENG_RUN_USD_BUDGET。
 *  仅当值是有限正数才采纳;否则该维不设(=不限)。 */
export function resolveRunBudget(env: Record<string, string | undefined>): Budget {
  const positive = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const budget: Budget = {};
  const maxTokens = positive(env.KUNPENG_RUN_TOKEN_BUDGET);
  const maxUsd = positive(env.KUNPENG_RUN_USD_BUDGET);
  if (maxTokens !== undefined) budget.maxTokens = maxTokens;
  if (maxUsd !== undefined) budget.maxUsd = maxUsd;
  return budget;
}

export interface BudgetHalt {
  halt: boolean;
  reason?: "tokens" | "usd";
  status: BudgetStatus;
}

/** 判断累计花费是否该熔断:checkBudget 判超即 halt。无预算 → 永不 halt。 */
export function budgetHalt(spentTokens: number, spentUsd: number, budget: Budget): BudgetHalt {
  const status = checkBudget({ tokens: spentTokens, usd: spentUsd }, budget);
  return { halt: status.over, reason: status.reason, status };
}
