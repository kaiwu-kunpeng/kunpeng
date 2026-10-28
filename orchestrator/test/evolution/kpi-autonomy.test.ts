import { describe, it, expect } from "vitest";
import { autonomyFromEscapeRate } from "../../src/evolution/kpi-autonomy.js";
import type { EscapeRate } from "../../src/metrics/escape-rate.js";

const er = (rate: number, merged = 10, escaped = 0): EscapeRate => ({ mergedCount: merged, escapedCount: escaped, rate, escapedFlowIds: [] });

describe("autonomyFromEscapeRate = 1 − 逃逸率（越自主越高）", () => {
  it("逃逸率 0.1 → 自主度 0.9，方向 higherBetter", () => {
    const s = autonomyFromEscapeRate(er(0.1, 10, 1));
    expect(s.key).toBe("autonomy");
    expect(s.value).toBeCloseTo(0.9, 6);
    expect(s.higherBetter).toBe(true);
  });
  it("逃逸率 0（全没回滚）→ 自主度 1", () => {
    expect(autonomyFromEscapeRate(er(0)).value).toBe(1);
  });
});
