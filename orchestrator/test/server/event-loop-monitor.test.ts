import { describe, expect, test } from "vitest";
import { summarizeEventLoopDelay, type EventLoopLag } from "../../src/server/event-loop-monitor.js";

function fakeHist(mean: number, max: number, p99: number) {
  return { mean, max, percentile: (p: number) => (p === 99 ? p99 : 0) };
}

describe("summarizeEventLoopDelay 纯转换 ns→ms", () => {
  test("常规直方图换算正确(ns→ms)", () => {
    const r: EventLoopLag = summarizeEventLoopDelay(fakeHist(5_000_000, 20_000_000, 15_000_000));
    expect(r).toEqual({ meanMs: 5, p99Ms: 15, maxMs: 20 });
  });

  test("保留 2 位小数", () => {
    const r = summarizeEventLoopDelay(fakeHist(1_234_567, 2_345_678, 1_999_999));
    expect(r.meanMs).toBeCloseTo(1.23, 2);
    expect(r.p99Ms).toBeCloseTo(2, 2);
    expect(r.maxMs).toBeCloseTo(2.35, 2);
  });

  test("采样前非有限值(Infinity/NaN)归 0,不产出 NaN", () => {
    const r = summarizeEventLoopDelay(fakeHist(Infinity, NaN, Infinity));
    expect(r).toEqual({ meanMs: 0, p99Ms: 0, maxMs: 0 });
  });

  test("零延迟", () => {
    expect(summarizeEventLoopDelay(fakeHist(0, 0, 0))).toEqual({ meanMs: 0, p99Ms: 0, maxMs: 0 });
  });
});