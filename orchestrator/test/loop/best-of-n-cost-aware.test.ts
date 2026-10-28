import { describe, expect, it } from "vitest";
import {
  MS_TIE_TOLERANCE,
  msWithinTolerance,
  selectBestCandidate,
  type Candidate,
} from "../../src/loop/best-of-n.js";

describe("msWithinTolerance 是相对容差", () => {
  it("差 10% 打平", () => {
    expect(msWithinTolerance(100, 110)).toBe(true);
    expect(msWithinTolerance(110, 100)).toBe(true);
  });

  it("差 3 倍不打平", () => {
    expect(msWithinTolerance(100, 300)).toBe(false);
  });

  it("默认容差是 20%：差 25% 不打平", () => {
    expect(MS_TIE_TOLERANCE).toBe(0.2);
    expect(msWithinTolerance(100, 125)).toBe(false);
  });

  it("两者都为 0 时打平", () => {
    expect(msWithinTolerance(0, 0)).toBe(true);
  });

  it("一方为 0 另一方非 0 时不打平", () => {
    expect(msWithinTolerance(0, 100)).toBe(false);
    expect(msWithinTolerance(100, 0)).toBe(false);
  });

  it("容差可由第三参覆盖", () => {
    expect(msWithinTolerance(100, 300, 5)).toBe(true);
    expect(msWithinTolerance(100, 110, 0.01)).toBe(false);
  });
});

describe("选优在墙钟接近时按成本决定", () => {
  it("实验回放：2026-08-23 那两个真实候选，必须选便宜的", () => {
    // c0 更慢 7% 但便宜 20%；改动前选优器会选 c1
    const result = selectBestCandidate([
      { id: "c0", passed: true, ms: 335277, cost: 516941 },
      { id: "c1", passed: true, ms: 312281, cost: 620995 },
    ]);
    expect(result.winner?.id).toBe("c0");
    expect(result.ranking.map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it("墙钟差异超出容差时仍由 ms 决定，成本不得反超", () => {
    const result = selectBestCandidate([
      { id: "slow-cheap", passed: true, ms: 300, cost: 1 },
      { id: "fast-pricey", passed: true, ms: 100, cost: 999 },
    ]);
    expect(result.winner?.id).toBe("fast-pricey");
  });

  it("score 仍优先于 ms 与 cost", () => {
    const result = selectBestCandidate([
      { id: "low-score-cheap-fast", passed: true, ms: 10, cost: 1, score: 1 },
      { id: "high-score", passed: true, ms: 1000, cost: 999, score: 2 },
    ]);
    expect(result.winner?.id).toBe("high-score");
  });

  it("未通过的候选永远排在通过者之后（哪怕更快更便宜）", () => {
    const result = selectBestCandidate([
      { id: "failed", passed: false, ms: 1, cost: 1 },
      { id: "passed", passed: true, ms: 9999, cost: 9999 },
    ]);
    expect(result.winner?.id).toBe("passed");
    expect(result.ranking.map((c) => c.id)).toEqual(["passed", "failed"]);
  });

  it("缺 cost 的候选不因此胜出（回落 Infinity）", () => {
    const result = selectBestCandidate([
      { id: "no-cost", passed: true, ms: 100 },
      { id: "has-cost", passed: true, ms: 105, cost: 50 },
    ]);
    expect(result.winner?.id).toBe("has-cost");
  });

  it("各项完全相同时保持输入顺序", () => {
    const result = selectBestCandidate([
      { id: "first", passed: true, ms: 100, cost: 5 },
      { id: "second", passed: true, ms: 100, cost: 5 },
    ]);
    expect(result.winner?.id).toBe("first");
  });

  it("不修改入参数组与候选对象", () => {
    const input: Candidate[] = [
      { id: "a", passed: true, ms: 200, cost: 9 },
      { id: "b", passed: true, ms: 210, cost: 3 },
    ];
    const snapshot = JSON.stringify(input);
    selectBestCandidate(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});