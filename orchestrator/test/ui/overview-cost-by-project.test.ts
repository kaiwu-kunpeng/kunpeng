import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0,
    flows: [],
    running: [],
    blockers: [],
    humanGates: [],
    artifacts: {},
    branches: [],
    statusCounts: {},
    systemLight: "green",
    agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: [],
    code: {
      srcLines: 0,
      testLines: 0,
      passedLines: 0,
      inFlightLines: 0,
      completed: 0,
      running: 0,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("renderOverview cost by project panel", () => {
  test("renders project token usage when costByProject is present", () => {
    const html = renderOverview(fixture({
      costByProject: [
        {
          id: "kunpeng",
          name: "鲲鹏",
          totalTokens: 5000,
          llmStages: 10,
          totalStages: 12,
          deterministicStages: 2,
          determinismRatio: 0.5,
          savedLlmCalls: 4,
          tokensByStage: {},
        },
        {
          id: "pz",
          name: "AcmeShop",
          totalTokens: 1200,
          llmStages: 3,
          totalStages: 4,
          deterministicStages: 1,
          determinismRatio: 0.25,
          savedLlmCalls: 1,
          tokensByStage: {},
        },
      ],
    }));

    expect(html).toContain('data-panel="cost-by-project"');
    expect(html).toContain("各项目用量");
    expect(html).toContain("鲲鹏");
    expect(html).toContain("AcmeShop");
    expect(html).toContain("token 5,000");
    expect(html).toContain("确定性 50%");
  });

  test("hides project token usage when costByProject is absent", () => {
    const html = renderOverview(fixture());

    expect(html).not.toContain('data-panel="cost-by-project"');
  });
});
