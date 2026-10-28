import { describe, it, expect } from "vitest";
import { computeEscapeRate } from "../../src/metrics/escape-rate.js";

describe("computeEscapeRate", () => {
  it("逃逸=已合并又被回滚 / 已合并", () => {
    const r = computeEscapeRate([
      { flowId: "a", merged: true, reverted: false },
      { flowId: "b", merged: true, reverted: true },
      { flowId: "c", merged: true, reverted: true },
      { flowId: "d", merged: false, reverted: true }, // 未合并不计
    ]);
    expect(r.mergedCount).toBe(3);
    expect(r.escapedCount).toBe(2);
    expect(r.escapedFlowIds).toEqual(["b", "c"]);
    expect(r.rate).toBeCloseTo(2 / 3, 5);
  });
  it("无已合并 → rate 0", () => {
    const r = computeEscapeRate([{ flowId: "x", merged: false, reverted: true }]);
    expect(r.mergedCount).toBe(0);
    expect(r.escapedCount).toBe(0);
    expect(r.rate).toBe(0);
  });
  it("全过审无回滚 → rate 0", () => {
    const r = computeEscapeRate([{ flowId: "a", merged: true, reverted: false }]);
    expect(r.rate).toBe(0);
    expect(r.escapedFlowIds).toEqual([]);
  });
});
