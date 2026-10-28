import { describe, expect, it } from "vitest";

import { budgetHalt, sumFlowUsd } from "./run-budget.js";

describe("run 预算 USD 维度", () => {
  it("sumFlowUsd 按后端模型口径累计,空表为 0", () => {
    expect(sumFlowUsd([])).toBe(0);
    const usd = sumFlowUsd([
      { tokensUsed: 1_000_000, backend: "claude" },
      { tokensUsed: 500_000 },
    ]);
    expect(usd).toBeGreaterThan(0);
  });

  it("USD 超限触发 halt,未超不触发", () => {
    const spent = sumFlowUsd([{ tokensUsed: 50_000_000, backend: "claude" }]);
    expect(spent).toBeGreaterThan(0.01);
    expect(budgetHalt(0, spent, { maxUsd: 0.01 }).halt).toBe(true);
    expect(budgetHalt(0, 0, { maxUsd: 0.01 }).halt).toBe(false);
  });
});