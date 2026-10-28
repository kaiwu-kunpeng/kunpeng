import { describe, it, expect } from "vitest";
import { combinedVerdict } from "../../src/evolution/combined-verdict.js";
import type { FitnessDelta } from "../../src/evolution/fitness.js";
import type { ProductKpiDelta } from "../../src/evolution/product-kpi.js";

const a = (o: Partial<FitnessDelta> = {}): FitnessDelta => ({ netSavedHoursDelta: 1, usdDelta: 0, verifiedDevFlowsDelta: 0, regressions: [], improved: true, ...o });
const b = (o: Partial<ProductKpiDelta> = {}): ProductKpiDelta => ({ key: "autonomy", label: "自主度", valueDelta: 0.1, improved: true, ...o });

describe("combinedVerdict 双维裁决：A 不退化 ∧ B 改进 = 真进步", () => {
  it("A 不退化 ∧ B 改进 → pass", () => {
    const v = combinedVerdict(a(), b());
    expect(v.pass).toBe(true);
    expect(v.reason).toContain("真进步");
  });
  it("A 退化（有回归）→ fail，即便 B 改进", () => {
    const v = combinedVerdict(a({ regressions: ["成本(USD)上升"] }), b());
    expect(v.pass).toBe(false);
    expect(v.aReason).toContain("成本(USD)上升");
  });
  it("A 净省工时下降 → fail（A 退化）", () => {
    expect(combinedVerdict(a({ netSavedHoursDelta: -2 }), b()).pass).toBe(false);
  });
  it("B 未改进 → fail，即便 A 不退化；reason 含 B 侧", () => {
    const v = combinedVerdict(a(), b({ improved: false, valueDelta: -0.05 }));
    expect(v.pass).toBe(false);
    expect(v.bReason).toContain("自主度");
    expect(v.bReason).toContain("未改进");
  });
});
