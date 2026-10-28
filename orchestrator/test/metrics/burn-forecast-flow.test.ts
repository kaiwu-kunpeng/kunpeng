import { describe, it, expect } from "vitest";
import { forecastBurnFromFlow } from "../../src/metrics/burn-forecast.js";

describe("A3 burn-forecast 从 flow 派生", () => {
  it("codex flow:1h 用 2M token → spent≈35 USD,预测正确", () => {
    // elapsedHours = (3_600_000 - 0)/3_600_000 = 1
    // codex = gpt-5.5 混合价 (5+30)/2 = 17.5 → spent = 2 * 17.5 = 35 USD
    const f = forecastBurnFromFlow(
      { tokensUsed: 2_000_000, startedAt: 0, updatedAt: 3_600_000, backend: "codex" },
      100,
    );
    expect(f.ratePerHourUsd).toBeCloseTo(35, 6);
    expect(f.remainingUsd).toBeCloseTo(65, 6);
    expect(f.hoursToCapacity).toBeCloseTo(65 / 35, 6);
    expect(f.exhausted).toBe(false);
  });

  it("elapsed=0(startedAt==updatedAt)时 rate 为 0,不除零", () => {
    const f = forecastBurnFromFlow(
      { tokensUsed: 1_000_000, startedAt: 5, updatedAt: 5, backend: "codex" },
      10,
    );
    expect(f.ratePerHourUsd).toBe(0);
    expect(Number.isFinite(f.remainingUsd)).toBe(true);
  });

  it("花费超预算 → remaining 归 0、exhausted", () => {
    // spent = estimateCostUsd({opus: 10_000_000}) = 10 * 15 = 150 USD > budget 100
    const f = forecastBurnFromFlow(
      { tokensUsed: 10_000_000, startedAt: 0, updatedAt: 3_600_000, backend: "opus" },
      100,
    );
    expect(f.remainingUsd).toBe(0);
    expect(f.exhausted).toBe(true);
  });

  it("tokensUsed/backend 缺失时不炸(按 default 单价、0 token)", () => {
    const f = forecastBurnFromFlow({ startedAt: 0, updatedAt: 3_600_000 }, 50);
    expect(f.remainingUsd).toBeCloseTo(50, 6);
    expect(f.exhausted).toBe(false);
  });
});