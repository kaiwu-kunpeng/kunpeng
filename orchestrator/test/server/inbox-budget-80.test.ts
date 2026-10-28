import { describe, expect, it } from "vitest";
import { budgetReviewItem } from "../../src/server/inbox-budget.js";

describe("收件箱预算提醒 80% 预警（作者锁定）", () => {
  it("80% → 接近预算；100% → 超预算；50% → 无", () => {
    const near = budgetReviewItem(0, { maxUsd: 10 }, 8.2);
    expect(near?.title).toBe("成本接近预算");
    expect(near?.detail).toContain("82%");
    const over = budgetReviewItem(0, { maxUsd: 10 }, 10);
    expect(over?.title).toBe("成本超预算");
    expect(over?.detail).toContain("100%");
    expect(budgetReviewItem(0, { maxUsd: 10 }, 5)).toBeNull();
    expect(budgetReviewItem(850_000, { maxTokens: 1_000_000 })?.title).toBe("成本接近预算");
    expect(budgetReviewItem(0, null, 100)).toBeNull();
  });
});