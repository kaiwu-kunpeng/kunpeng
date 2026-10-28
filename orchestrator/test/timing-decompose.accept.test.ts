import { describe, expect, it } from "vitest";
import { createTimingAgg, timingAggFeed, timingAggFinish } from "../src/server/chat-usage.js";

describe("耗时分解聚合(作者验收)", () => {
  it("串行两次工具调用累计", () => {
    const agg = createTimingAgg();
    timingAggFeed(agg, { kind: "toolUse", at: 1000, toolId: "a" });
    timingAggFeed(agg, { kind: "toolResult", at: 3000, toolId: "a" });
    timingAggFeed(agg, { kind: "toolUse", at: 5000, toolId: "b" });
    timingAggFeed(agg, { kind: "toolResult", at: 6000, toolId: "b" });
    const r = timingAggFinish(agg, 10000);
    expect(r.toolMs).toBe(3000);
    expect(r.modelMs).toBe(7000);
    expect(r.turns).toBe(2);
  });
  it("并行重叠区间按并集不重复计", () => {
    const agg = createTimingAgg();
    timingAggFeed(agg, { kind: "toolUse", at: 1000, toolId: "a" });
    timingAggFeed(agg, { kind: "toolUse", at: 2000, toolId: "b" });
    timingAggFeed(agg, { kind: "toolResult", at: 4000, toolId: "a" });
    timingAggFeed(agg, { kind: "toolResult", at: 5000, toolId: "b" });
    const r = timingAggFinish(agg, 8000);
    expect(r.toolMs).toBe(4000);
    expect(r.turns).toBe(2);
  });
  it("未闭合区间 finish 截断", () => {
    const agg = createTimingAgg();
    timingAggFeed(agg, { kind: "toolUse", at: 6000, toolId: "x" });
    const r = timingAggFinish(agg, 9000);
    expect(r.toolMs).toBe(3000);
    expect(r.turns).toBe(1);
  });
  it("无工具调用", () => {
    const r = timingAggFinish(createTimingAgg(), 5000);
    expect(r.toolMs).toBe(0);
    expect(r.modelMs).toBe(5000);
    expect(r.turns).toBe(0);
  });
});