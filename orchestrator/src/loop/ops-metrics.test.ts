import { describe, it, expect } from "vitest";
import { loopOpsMetrics, recurringGotchas } from "./ops-metrics.js";

const DAY = 86_400_000;

describe("loopOpsMetrics", () => {
  const now = 1_000 * DAY;

  it("30天窗口内计波次/验证率/指标合计，lastWaveAt 取全量最新", () => {
    const m = loopOpsMetrics([
      { at: now - 40 * DAY, verified: true, metricDelta: 100 },
      { at: now - 10 * DAY, verified: true, metricDelta: 5 },
      { at: now - 2 * DAY, verified: false, metricDelta: 3 },
    ], now);
    expect(m.waves30d).toBe(2);
    expect(m.verifiedRate30d).toBeCloseTo(0.5);
    expect(m.metricDelta30d).toBe(8);
    expect(m.lastWaveAt).toBe(now - 2 * DAY);
    expect(m.stalled).toBe(false);
  });

  it("超 stallMs 无波→stalled；从无波→stalled 且窗口全零", () => {
    const old = loopOpsMetrics([{ at: now - 20 * DAY, verified: true, metricDelta: 1 }], now);
    expect(old.stalled).toBe(true);
    const empty = loopOpsMetrics([], now);
    expect(empty).toMatchObject({ waves30d: 0, verifiedRate30d: 0, metricDelta30d: 0, stalled: true });
    expect(empty.lastWaveAt).toBeUndefined();
  });
});

describe("recurringGotchas", () => {
  it("跨波计数、同波去重、min 过滤、排序、top 截断", () => {
    const waves = [
      { at: 1, verified: true, metricDelta: 0, gotchas: ["换区未生效", "换区未生效", "反爬"] },
      { at: 2, verified: true, metricDelta: 0, gotchas: [" 换区未生效 ", "薄品类"] },
      { at: 3, verified: false, metricDelta: 0, gotchas: ["反爬", "薄品类"] },
    ];
    const got = recurringGotchas(waves);
    expect(got).toEqual([
      { gotcha: "反爬", count: 2 },
      { gotcha: "换区未生效", count: 2 },
      { gotcha: "薄品类", count: 2 },
    ]);
    expect(recurringGotchas(waves, { min: 3 })).toEqual([]);
    expect(recurringGotchas(waves, { top: 1 }).length).toBe(1);
  });

  it("无 gotchas 波安全返回空", () => {
    expect(recurringGotchas([{ at: 1, verified: true, metricDelta: 1 }])).toEqual([]);
  });
});