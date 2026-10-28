import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCostBudget, budgetReviewItem } from "../../src/server/inbox-budget.js";

describe("成本超预算汇入收件箱(作者验收)", () => {
  it("loadCostBudget 读回;缺失/损坏 → null", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-budget-"));
    const p = join(dir, "cost-budget.json");
    writeFileSync(p, JSON.stringify({ maxUsd: 10 }));
    expect(loadCostBudget(p)?.maxUsd).toBe(10);
    expect(loadCostBudget(join(dir, "nope.json"))).toBeNull();
    writeFileSync(join(dir, "bad.json"), "{ broken");
    expect(loadCostBudget(join(dir, "bad.json"))).toBeNull();
  });

  it("budgetReviewItem 超阈值出条目,否则 null", () => {
    expect(budgetReviewItem(5000, { maxTokens: 1000 })!.kind).toBe("budget");
    expect(budgetReviewItem(500, { maxTokens: 1000 })).toBeNull();
    expect(budgetReviewItem(100, null)).toBeNull();
    expect(budgetReviewItem(100_000_000, { maxUsd: 1 })!.kind).toBe("budget");
  });
});