import { describe, it, expect } from "vitest";
import { collectFlowTruth } from "../../src/server/state-collect/flows.js";
import { collectEvolutionTruth } from "../../src/server/state-collect/evolution.js";
import { collectPlansCode } from "../../src/server/state-collect/plans-code.js";

describe("collectState 按域析出", () => {
  it("三个域收集器可独立调用(空输入健壮)", async () => {
    const flowTruth = collectFlowTruth({ allFlows: [], arts: [], now: Date.now() });
    expect(flowTruth.flows).toEqual([]);
    expect(flowTruth.agents).toBe(1);
    expect(flowTruth.systemLight).toBeDefined();
    expect(flowTruth.activity.total).toBe(0);
    expect(flowTruth.activity.successRate).toBe(1);

    const evo = await collectEvolutionTruth({ arts: [], repoRoot: "/nonexistent-kp-test" });
    expect(evo.evolution.proposals).toEqual([]);
    expect(evo.evolution.approvedCount).toBe(0);

    const pc = await collectPlansCode({ repoRoot: "/nonexistent-kp-test", store: { listSummaries: async () => [], read: async () => { throw new Error("no"); } } as never, arts: [], flows: [], now: Date.now() });
    expect(pc.plans).toEqual([]);
    expect(pc.code.completed).toBe(0);
  });
});