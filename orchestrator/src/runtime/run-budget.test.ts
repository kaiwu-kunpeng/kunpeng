import { describe, expect, test } from "vitest";
import { resolveRunBudget, budgetHalt } from "./run-budget.js";

describe("resolveRunBudget", () => {
  test("both env vars → both limits", () => {
    expect(resolveRunBudget({ KUNPENG_RUN_TOKEN_BUDGET: "100000", KUNPENG_RUN_USD_BUDGET: "5" }))
      .toEqual({ maxTokens: 100000, maxUsd: 5 });
  });
  test("only token budget", () => {
    expect(resolveRunBudget({ KUNPENG_RUN_TOKEN_BUDGET: "50000" })).toEqual({ maxTokens: 50000 });
  });
  test("invalid / zero / negative / missing → unset", () => {
    expect(resolveRunBudget({})).toEqual({});
    expect(resolveRunBudget({ KUNPENG_RUN_TOKEN_BUDGET: "0", KUNPENG_RUN_USD_BUDGET: "-3" })).toEqual({});
    expect(resolveRunBudget({ KUNPENG_RUN_TOKEN_BUDGET: "abc" })).toEqual({});
  });
});

describe("budgetHalt", () => {
  test("under budget → no halt", () => {
    const h = budgetHalt(400, 0, { maxTokens: 1000 });
    expect(h.halt).toBe(false);
    expect(h.reason).toBeUndefined();
  });
  test("over token budget → halt with reason tokens", () => {
    const h = budgetHalt(1500, 0, { maxTokens: 1000 });
    expect(h.halt).toBe(true);
    expect(h.reason).toBe("tokens");
    expect(h.status.over).toBe(true);
  });
  test("no budget → never halt", () => {
    expect(budgetHalt(999999, 999, {}).halt).toBe(false);
  });
});
