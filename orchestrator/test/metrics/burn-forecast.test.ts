import { describe, it, expect } from "vitest";
import { forecastBurn, willExhaustWithin } from "../../src/metrics/burn-forecast.js";

describe("forecastBurn", () => {
  it("从花费/时长派生速率与耗尽时点", () => {
    // 花 $20、预算 $100、用了 2 小时 → rate=$10/h、剩 $80 → 还能撑 8 小时
    const f = forecastBurn({ spentUsd: 20, budgetUsd: 100, elapsedHours: 2 });
    expect(f.ratePerHourUsd).toBeCloseTo(10);
    expect(f.remainingUsd).toBeCloseTo(80);
    expect(f.hoursToCapacity).toBeCloseTo(8);
    expect(f.exhausted).toBe(false);
  });

  it("已超支:hoursToCapacity=0、exhausted=true、remaining 截断为 0", () => {
    const f = forecastBurn({ spentUsd: 120, budgetUsd: 100, elapsedHours: 3 });
    expect(f.exhausted).toBe(true);
    expect(f.hoursToCapacity).toBe(0);
    expect(f.remainingUsd).toBe(0);
  });

  it("elapsedHours=0 → rate=0、hoursToCapacity=null(无从推算)", () => {
    const f = forecastBurn({ spentUsd: 5, budgetUsd: 100, elapsedHours: 0 });
    expect(f.ratePerHourUsd).toBe(0);
    expect(f.hoursToCapacity).toBeNull();
  });
});

describe("willExhaustWithin", () => {
  it("速率高时在地平线内会耗尽", () => {
    // rate=$10/h、剩 $80 → 8h 耗尽;问 10h 内会否 → true
    expect(willExhaustWithin({ spentUsd: 20, budgetUsd: 100, elapsedHours: 2 }, 10)).toBe(true);
  });

  it("地平线短于耗尽时长 → false", () => {
    expect(willExhaustWithin({ spentUsd: 20, budgetUsd: 100, elapsedHours: 2 }, 5)).toBe(false);
  });

  it("速率为 0(elapsed=0) → 不会判定耗尽", () => {
    expect(willExhaustWithin({ spentUsd: 5, budgetUsd: 100, elapsedHours: 0 }, 100)).toBe(false);
  });
});