import { checkBudget, type Budget, type BudgetStatus } from "./cost-budget.js";
import { estimateCostUsd, type CostUsd } from "./cost-pricing.js";

export interface StageSpend {
  stage: string;
  model: string;
  tokens: number;
}

export interface CostReport {
  /** 所有阶段 token 之和。 */
  totalTokens: number;
  /** model -> 该模型累计 token（同名模型累加）。 */
  tokensByModel: Record<string, number>;
  /** 复用 estimateCostUsd(tokensByModel) 的结果。 */
  cost: CostUsd;
  /** 仅当传入 budget 时存在：checkBudget({tokens: totalTokens, usd: cost.totalUsd}, budget)。 */
  budget?: BudgetStatus;
}

export function buildCostReport(stages: StageSpend[], budget?: Budget): CostReport {
  const tokensByModel: Record<string, number> = {};
  let totalTokens = 0;

  for (const stage of stages) {
    totalTokens += stage.tokens;
    tokensByModel[stage.model] = (tokensByModel[stage.model] ?? 0) + stage.tokens;
  }

  const cost = estimateCostUsd(tokensByModel);
  const report: CostReport = { totalTokens, tokensByModel, cost };

  if (budget !== undefined) {
    report.budget = checkBudget({ tokens: totalTokens, usd: cost.totalUsd }, budget);
  }

  return report;
}

/** 一行中文摘要：含总 token、总 USD、模型数；有 budget 时追加预算状态。 */
export function formatCostReport(report: CostReport): string {
  const modelCount = Object.keys(report.tokensByModel).length;
  const parts = [`总 ${report.totalTokens} tokens`, `$${report.cost.totalUsd.toFixed(2)}`, `${modelCount} 模型`];

  if (report.budget !== undefined) {
    if (report.budget.over) {
      parts.push("超预算");
    } else {
      const percent = Math.round(Math.max(report.budget.tokenRatio, report.budget.usdRatio) * 100);
      parts.push(`已用 ${percent}%`);
    }
  }

  return parts.join(" · ");
}
