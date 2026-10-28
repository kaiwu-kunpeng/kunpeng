import { describe, it, expect } from "vitest";
import type { DashboardState } from "../src/server/state.js";
import { renderMetricsPanel, renderEvolutionPanel, renderLoopHealthPanel } from "../src/server/ui/views/overview.js";

function state(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], artifacts: {},
    statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "" }, designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    humanGates: [], branches: [], plans: [], ...overrides,
  };
}

const metricsState = state({
  autoCompletion: { attempted: 5, autoCompleted: 3, neededIntervention: 2, rate: 0.6, target: 0.8, meetsTarget: false },
  tokenTrend: { samples: 4, avgTokensPerReq: 1500, recentAvg: 1200, olderAvg: 1800, trend: "down" },
  gateConservation: { ok: true, allowed: ["合并主干", "改宪法", "对外发布"], violations: [] },
});

describe("renderMetricsPanel (F-07)", () => {
  it("渲染自动完成率/目标/度量标题", () => {
    const h = renderMetricsPanel(metricsState);
    expect(h).toContain("60%");
    expect(h).toContain("80%");
    expect(h).toContain("度量");
  });
  it("无度量数据→空串不抛", () => {
    expect(renderMetricsPanel(state())).toBe("");
  });
});

const evoState = state({
  evolution: {
    lastRunText: "巡检于刚刚",
    pendingCount: 3,
    approvedCount: 1,
    proposals: [{ id: "p1", status: "draft", summary: "提案甲蒸馏约定", hasEvidence: true }],
    regression: { holdout: 2, optimization: 1 },
    upgrades: [],
  },
});

describe("renderEvolutionPanel", () => {
  it("渲染待审数/提案摘要/上次巡检", () => {
    const h = renderEvolutionPanel(evoState);
    expect(h).toContain("提案甲蒸馏约定");
    expect(h).toContain("巡检于刚刚");
    expect(h).toContain("3");
  });
  it("全空→空串", () => {
    expect(renderEvolutionPanel(state({ evolution: { lastRunText: "", pendingCount: 0, approvedCount: 0, proposals: [], regression: { holdout: 0, optimization: 0 }, upgrades: [] } }))).toBe("");
  });
});

const loopState = state({
  loops: [{
    id: "cat", name: "扩品类弧线",
    summary: { trend: "升", recent: "", blockers: "", next: "气盖" },
    metric: { label: "pwq", current: 5060 }, waveCount: 32,
    nextLever: { id: "GAS", label: "气盖", status: "needs-dev" },
    recent: [], leversByStatus: { active: [], needsDev: [], honestZero: [] }, gotchas: [],
  }],
});

describe("renderLoopHealthPanel", () => {
  it("渲染 loop 名/指标/波数", () => {
    const h = renderLoopHealthPanel(loopState);
    expect(h).toContain("扩品类弧线");
    expect(h).toContain("5060");
    expect(h).toContain("pwq");
    expect(h).toContain("32");
  });
  it("无 loop→空串", () => {
    expect(renderLoopHealthPanel(state({ loops: [] }))).toBe("");
  });
});
