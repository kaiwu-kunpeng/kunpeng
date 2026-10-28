import { describe, expect, test } from "vitest";
import { checkBudget, formatBudgetStatus } from "./cost-budget.js";

describe("checkBudget", () => {
  test("no limits → never over, infinite remaining, zero ratios", () => {
    const s = checkBudget({ tokens: 999999, usd: 999 }, {});
    expect(s.over).toBe(false);
    expect(s.reason).toBeUndefined();
    expect(s.tokenRatio).toBe(0);
    expect(s.usdRatio).toBe(0);
    expect(s.remainingTokens).toBe(Infinity);
    expect(s.remainingUsd).toBe(Infinity);
  });

  test("under token budget", () => {
    const s = checkBudget({ tokens: 400, usd: 0 }, { maxTokens: 1000 });
    expect(s.over).toBe(false);
    expect(s.tokenRatio).toBeCloseTo(0.4, 5);
    expect(s.remainingTokens).toBe(600);
    expect(s.remainingUsd).toBe(Infinity);
  });

  test("at token budget is over (>=)", () => {
    const s = checkBudget({ tokens: 1000, usd: 0 }, { maxTokens: 1000 });
    expect(s.over).toBe(true);
    expect(s.reason).toBe("tokens");
    expect(s.remainingTokens).toBe(0);
  });

  test("over usd budget", () => {
    const s = checkBudget({ tokens: 0, usd: 12.5 }, { maxUsd: 10 });
    expect(s.over).toBe(true);
    expect(s.reason).toBe("usd");
    expect(s.usdRatio).toBeCloseTo(1.25, 5);
    expect(s.remainingUsd).toBe(0);
  });

  test("tokens take priority in reason when both exceeded", () => {
    const s = checkBudget({ tokens: 2000, usd: 50 }, { maxTokens: 1000, maxUsd: 10 });
    expect(s.over).toBe(true);
    expect(s.reason).toBe("tokens");
  });

  test("remaining never negative", () => {
    const s = checkBudget({ tokens: 5000, usd: 0 }, { maxTokens: 1000 });
    expect(s.remainingTokens).toBe(0);
  });
});

describe("formatBudgetStatus", () => {
  test("within budget shows used percent", () => {
    const b = { maxTokens: 1000, maxUsd: 10 };
    const txt = formatBudgetStatus(checkBudget({ tokens: 500, usd: 5 }, b), b);
    expect(txt).toContain("50%");
  });

  test("over budget flags 超预算", () => {
    const b = { maxTokens: 1000 };
    const txt = formatBudgetStatus(checkBudget({ tokens: 1500, usd: 0 }, b), b);
    expect(txt).toContain("超预算");
  });

  test("no limits → 无上限", () => {
    expect(formatBudgetStatus(checkBudget({ tokens: 0, usd: 0 }, {}), {})).toContain("无上限");
  });
});
