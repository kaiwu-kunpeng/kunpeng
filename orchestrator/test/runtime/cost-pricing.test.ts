import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/runtime/cost-pricing.js";
import type { DashboardState } from "../../src/server/state.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";

describe("estimateCostUsd", () => {
  it("按模型定价折算", () => {
    // 混合价 = (input+output)/2:opus (5+25)/2=15;sonnet-4-6 (3+15)/2=9
    const r = estimateCostUsd({ "claude-opus-4-8": 1_000_000, "claude-sonnet-4-6": 2_000_000 });
    expect(r.totalUsd).toBe(33);
    expect(r.byModel["claude-opus-4-8"]).toBe(15);
    expect(r.byModel["claude-sonnet-4-6"]).toBe(18);
  });
  it("haiku / 未知 / 空", () => {
    expect(estimateCostUsd({ "claude-haiku-4-5": 1_000_000 }).totalUsd).toBe(3);
    expect(estimateCostUsd({ "weird-model": 1_000_000 }).totalUsd).toBe(3);
    expect(estimateCostUsd({}).totalUsd).toBe(0);
  });
});

function ovFixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [],
    statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("overview 成本区显示 $ 估算", () => {
  it("含估算金额", () => {
    const html = renderOverview(ovFixture({
      costSummary: { totalStages: 1, llmStages: 1, deterministicStages: 0, totalTokens: 1_000_000, determinismRatio: 0, savedLlmCalls: 0, tokensByStage: { spec: 1_000_000 }, tokensByModel: { "claude-opus-4-8": 1_000_000 } },
    }));
    expect(html).toContain("估算");
    expect(html).toContain("$15");
  });
});