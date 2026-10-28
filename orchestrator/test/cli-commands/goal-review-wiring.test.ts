import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("goal review 命令接线（作者锁定）", () => {
  it("goals.ts 有 review/accept/reject/reviews 子命令并调用 runGoalReview/acceptGoalReview", () => {
    const src = readFileSync(new URL("../../src/cli-commands/goals.ts", import.meta.url), "utf8");
    for (const s of ['"review"', '"accept"', '"reject"', '"reviews"', "runGoalReview(", "acceptGoalReview(", "rejectGoalReview(", "GoalReviewStore"]) expect(src).toContain(s);
    expect(src).toContain("kunpeng goal accept");
  });
});