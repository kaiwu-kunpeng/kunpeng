import { describe, it, expect } from "vitest";
import { computeEscapeRateByWindow } from "../../src/metrics/escape-rate.js";

describe("computeEscapeRateByWindow", () => {
  it("只统计窗口内 mergedAt 的记录,口径同 computeEscapeRate", () => {
    const now = 1000;
    const r = computeEscapeRateByWindow(
      [
        { flowId: "in1", merged: true, reverted: true, mergedAt: 950 }, // 窗内,逃逸
        { flowId: "in2", merged: true, reverted: false, mergedAt: 980 }, // 窗内,没逃
        { flowId: "old", merged: true, reverted: true, mergedAt: 100 }, // 窗外(太老)
        { flowId: "nots", merged: true, reverted: true }, // 无 mergedAt,不计
      ],
      200,
      now,
    ); // 窗口 (800,1000]
    expect(r.mergedCount).toBe(2);
    expect(r.escapedCount).toBe(1);
    expect(r.escapedFlowIds).toEqual(["in1"]);
    expect(r.rate).toBeCloseTo(0.5, 5);
  });

  it("窗口内无记录 → rate 0", () => {
    const r = computeEscapeRateByWindow([{ flowId: "x", merged: true, reverted: true, mergedAt: 1 }], 10, 1000);
    expect(r.mergedCount).toBe(0);
    expect(r.rate).toBe(0);
  });
});
