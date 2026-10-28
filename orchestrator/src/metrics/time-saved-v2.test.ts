import { describe, expect, it } from "vitest";
import {
  aggregateSavings,
  flowSaving,
  resolveHumanEquiv,
  savingsV2,
  type FlowLike,
} from "./time-saved.js";

function devFlow(overrides: Partial<FlowLike> = {}): FlowLike {
  return {
    status: "verified",
    requirement: "加一个按钮",
    history: [
      { stage: "implement", at: 0 },
      { stage: "verify", at: 600_000 },
    ],
    ...overrides,
  };
}

describe("savings v2", () => {
  it("resolveHumanEquiv 默认 25/90,env 可覆盖且 source=env", () => {
    const def = resolveHumanEquiv({} as NodeJS.ProcessEnv);
    expect(def.humanEquivMinutes.simple).toBe(25);
    expect(def.humanEquivMinutes.complex).toBe(90);
    expect(def.source).toBe("default");
    const env = resolveHumanEquiv({
      KUNPENG_HUMAN_EQUIV_SIMPLE: "10",
      KUNPENG_HUMAN_EQUIV_COMPLEX: "40",
    } as NodeJS.ProcessEnv);
    expect(env.humanEquivMinutes.simple).toBe(10);
    expect(env.humanEquivMinutes.complex).toBe(40);
    expect(env.source).toBe("env");
  });

  it("flowSaving 可用自定义当量,humanEstimateMin 跟随该复杂度取值", () => {
    const override = { simple: 11, complex: 44 };
    const s = flowSaving(devFlow(), { humanEquiv: override });
    expect(s.humanEstimateMin).toBe(override[s.complexity]);
  });

  it("SavingsRollup 汇总 loopTokensUsed", () => {
    const rollup = aggregateSavings([
      devFlow({ tokensUsed: 1000 }),
      devFlow({ tokensUsed: 2000 }),
      devFlow(),
    ]);
    expect(rollup.loopTokensUsed).toBe(3000);
  });

  it("savingsV2 新旧并排:维护税入账,可为负,假设显性", () => {
    const v2 = savingsV2([devFlow({ tokensUsed: 500 })], { maintenanceMinutes: 90 });
    expect(v2.v1.flows).toBe(1);
    expect(v2.maintenanceTaxHours).toBe(1.5);
    expect(v2.netAfterMaintenanceHours).toBeCloseTo(v2.v1.netSavedHours - 1.5, 5);
    expect(v2.loopTokensUsed).toBe(500);
    expect(v2.assumptions.humanEquivMinutes.simple).toBe(25);
    expect(v2.assumptions.source).toBe("default");
  });

  it("既有 v1 行为不回归:不带 opts 的 flowSaving 与 aggregateSavings 结果字段齐全", () => {
    const s = flowSaving(devFlow());
    expect(s.humanEstimateMin === 25 || s.humanEstimateMin === 90).toBe(true);
    const r = aggregateSavings([devFlow()]);
    expect(r.verifiedDevFlows).toBe(1);
    expect(typeof r.netSavedHours).toBe("number");
  });
});