import { describe, it, expect } from "vitest";
import { fitnessSnapshot, compareFitness, type FitnessSnapshot } from "../../src/evolution/fitness.js";
import type { FlowLike } from "../../src/metrics/time-saved.js";
import type { CostReport } from "../../src/runtime/cost-report.js";

const snap = (o: Partial<FitnessSnapshot> = {}): FitnessSnapshot => ({
  netSavedHours: 0, verifiedDevFlows: 0, totalUsd: 0, totalTokens: 0, ...o,
});

describe("compareFitness 真适应度门(净省工时↑ ∧ 无未瞄准退化)", () => {
  it("净省工时升 + 成本不增 + verified不降 → improved", () => {
    const d = compareFitness(
      snap({ netSavedHours: 10, verifiedDevFlows: 3, totalUsd: 5 }),
      snap({ netSavedHours: 14, verifiedDevFlows: 3, totalUsd: 5 }),
    );
    expect(d.improved).toBe(true);
    expect(d.netSavedHoursDelta).toBe(4);
    expect(d.regressions).toEqual([]);
  });
  it("净省工时升但 verifiedDevFlows 下降 → 非回归门判否", () => {
    const d = compareFitness(
      snap({ netSavedHours: 10, verifiedDevFlows: 4 }),
      snap({ netSavedHours: 20, verifiedDevFlows: 3 }),
    );
    expect(d.improved).toBe(false);
    expect(d.regressions).toContain("verifiedDevFlows 下降");
  });
  it("净省工时升但成本涨得更快(效率恶化) → 非回归门判否", () => {
    // USD 5→9(+80%) 远超净省工时 10→12(+20%)：效率 0.5→0.75 恶化 → 拦截
    const d = compareFitness(
      snap({ netSavedHours: 10, totalUsd: 5 }),
      snap({ netSavedHours: 12, totalUsd: 9 }),
    );
    expect(d.improved).toBe(false);
    expect(d.regressions).toContain("成本效率恶化(USD/净省工时h ↑)");
  });
  it("成本随价值同比例上涨(效率不变) → 不算回归(累计绝对值上涨不该误判)", () => {
    // USD 5→6、净省工时 10→12：效率 0.5→0.5 持平 → 成本不计回归，净省↑即变强
    const d = compareFitness(
      snap({ netSavedHours: 10, totalUsd: 5 }),
      snap({ netSavedHours: 12, totalUsd: 6 }),
    );
    expect(d.regressions).not.toContain("成本效率恶化(USD/净省工时h ↑)");
    expect(d.improved).toBe(true);
  });
  it("净省工时持平 → 不算变强", () => {
    const d = compareFitness(snap({ netSavedHours: 10 }), snap({ netSavedHours: 10 }));
    expect(d.improved).toBe(false);
  });
});

describe("fitnessSnapshot 从真实 flow+成本汇总", () => {
  it("认 verified dev flow 的净省工时,并汇总成本美元与 token", () => {
    const flows: FlowLike[] = [
      {
        status: "verified",
        requirement: "做个功能",
        startedAt: 0,
        updatedAt: 120000,
        history: [
          { stage: "spec", at: 0 },
          { stage: "implement", at: 60000 },
          { stage: "verify", at: 120000 },
        ],
      },
    ];
    const costs: CostReport[] = [{
      totalTokens: 1000,
      tokensByModel: {},
      cost: { totalUsd: 2, byModel: {} },
    }];
    const s = fitnessSnapshot(flows, costs);
    expect(s.totalUsd).toBe(2);
    expect(s.totalTokens).toBe(1000);
    expect(s.netSavedHours).toBeGreaterThan(0);
    expect(s.verifiedDevFlows).toBe(1);
  });
});
