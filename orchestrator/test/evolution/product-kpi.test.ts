import { describe, it, expect } from "vitest";
import { compareKpi, type ProductKpiSnapshot } from "../../src/evolution/product-kpi.js";

const snap = (value: number, higherBetter: boolean): ProductKpiSnapshot => ({ key: "k", label: "K", value, higherBetter });

describe("compareKpi 方向感知", () => {
  it("higherBetter → Δ>0 才 improved", () => {
    expect(compareKpi(snap(0.4, true), snap(0.6, true)).improved).toBe(true);
    expect(compareKpi(snap(0.6, true), snap(0.4, true)).improved).toBe(false);
  });
  it("lowerBetter → Δ<0 才 improved", () => {
    expect(compareKpi(snap(0.6, false), snap(0.4, false)).improved).toBe(true);
    expect(compareKpi(snap(0.4, false), snap(0.6, false)).improved).toBe(false);
  });
  it("持平 → 不算改进，且 valueDelta 有符号", () => {
    const d = compareKpi(snap(0.5, true), snap(0.5, true));
    expect(d.improved).toBe(false);
    expect(d.valueDelta).toBe(0);
  });
});
