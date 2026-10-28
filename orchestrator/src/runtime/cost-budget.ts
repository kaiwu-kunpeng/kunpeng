export interface Budget {
  /** token 上限；未设 = 不限 token。 */
  maxTokens?: number;
  /** USD 上限；未设 = 不限 USD。 */
  maxUsd?: number;
}

export interface Spend {
  tokens: number;
  usd: number;
}

export interface BudgetStatus {
  /** 任一已设上限被触达(>=)即为超预算。 */
  over: boolean;
  /** 触发超预算的维度；tokens 优先于 usd；未超时为 undefined。 */
  reason?: "tokens" | "usd";
  /** spend.tokens / maxTokens；maxTokens 未设时为 0。 */
  tokenRatio: number;
  /** spend.usd / maxUsd；maxUsd 未设时为 0。 */
  usdRatio: number;
  /** max(0, maxTokens - spend.tokens)；maxTokens 未设时为 Infinity。 */
  remainingTokens: number;
  /** max(0, maxUsd - spend.usd)；maxUsd 未设时为 Infinity。 */
  remainingUsd: number;
}

function hasTokenLimit(budget: Budget): budget is Budget & { maxTokens: number } {
  return budget.maxTokens !== undefined;
}

function hasUsdLimit(budget: Budget): budget is Budget & { maxUsd: number } {
  return budget.maxUsd !== undefined;
}

export function checkBudget(spend: Spend, budget: Budget): BudgetStatus {
  const tokenLimited = hasTokenLimit(budget);
  const usdLimited = hasUsdLimit(budget);

  const tokenRatio = tokenLimited ? spend.tokens / budget.maxTokens : 0;
  const usdRatio = usdLimited ? spend.usd / budget.maxUsd : 0;
  const remainingTokens = tokenLimited ? Math.max(0, budget.maxTokens - spend.tokens) : Infinity;
  const remainingUsd = usdLimited ? Math.max(0, budget.maxUsd - spend.usd) : Infinity;

  const tokensOver = tokenLimited && spend.tokens >= budget.maxTokens;
  const usdOver = usdLimited && spend.usd >= budget.maxUsd;

  return {
    over: tokensOver || usdOver,
    reason: tokensOver ? "tokens" : usdOver ? "usd" : undefined,
    tokenRatio,
    usdRatio,
    remainingTokens,
    remainingUsd,
  };
}

/** 一行中文摘要：无任何上限→含「无上限」；超预算→含「超预算」+触发维度；否则含「已用 N%」(取 token/usd 比率较大者四舍五入的百分比)。 */
export function formatBudgetStatus(status: BudgetStatus, budget: Budget): string {
  const tokenLimited = hasTokenLimit(budget);
  const usdLimited = hasUsdLimit(budget);

  if (!tokenLimited && !usdLimited) {
    return "预算无上限";
  }

  if (status.over) {
    const reason = status.reason === "tokens" ? "token" : "USD";
    return `超预算：${reason}`;
  }

  const percent = Math.round(Math.max(status.tokenRatio, status.usdRatio) * 100);
  return `预算已用 ${percent}%`;
}
