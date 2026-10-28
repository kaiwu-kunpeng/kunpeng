import { describe, it, expect } from "vitest";
import { fitnessVerdict, summarizeFitness } from "../../src/evolution/fitness-gate.js";
import { hasApplicableEvidence, type ProposalEvidence } from "../../src/loop/self-evolution.js";
import type { FitnessDelta, FitnessSnapshot } from "../../src/evolution/fitness.js";

const delta = (o: Partial<FitnessDelta> = {}): FitnessDelta => ({
  netSavedHoursDelta: 0, usdDelta: 0, verifiedDevFlowsDelta: 0, regressions: [], improved: false, ...o,
});

describe("fitnessVerdict", () => {
  it("improved → pass", () => {
    expect(fitnessVerdict(delta({ netSavedHoursDelta: 2.1, improved: true })).pass).toBe(true);
  });
  it("有回归 → 拦截且 reason 带回归原因", () => {
    const v = fitnessVerdict(delta({ improved: false, regressions: ["成本(USD)上升"] }));
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("成本(USD)上升");
  });
});

describe("hasApplicableEvidence fitness-first（替 holdoutPassK 主信号）", () => {
  it("有 fitness 证据 → 以 improved 为准（即便无 holdoutPassK 也放行）", () => {
    expect(hasApplicableEvidence({ fitness: delta({ improved: true }) } as ProposalEvidence)).toBe(true);
  });
  it("fitness.improved=false → 拦截（即便 holdoutPassK 本会放行）", () => {
    expect(hasApplicableEvidence({
      holdoutPassK: 0.9,
      baseline: { holdoutPassK: 0.1 },
      fitness: delta({ improved: false }),
    } as ProposalEvidence)).toBe(false);
  });
  it("无 fitness → 后备到 holdoutPassK 旧逻辑（行为不变）", () => {
    expect(hasApplicableEvidence({
      holdoutPassK: 0.9,
      baseline: { holdoutPassK: 0.1 },
    } as ProposalEvidence)).toBe(true);
    expect(hasApplicableEvidence(undefined)).toBe(false);
  });
});

describe("summarizeFitness", () => {
  it("产出含净省工时的可读摘要", () => {
    const s: FitnessSnapshot = { netSavedHours: 53.2, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 1200 };
    expect(summarizeFitness(s)).toContain("53.2");
  });
});
