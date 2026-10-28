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

describe("renderOverview usage panel", () => {
  test("renders token, conversation, stage, and model usage", () => {
    const html = renderOverview(fixture({
      costSummary: {
        totalStages: 0,
        totalTokens: 1148910,
        llmStages: 709,
        tokensByStage: { spec: 103196, implement: 85859 },
        determinismRatio: 0.5,
        deterministicStages: 0,
        savedLlmCalls: 0,
      },
      quota: {
        accounts: [
          {
            id: "a",
            used: 12,
            models: [
              { model: "haiku", calls: 4 },
              { model: "medium", calls: 8 },
            ],
          },
        ],
        total: 12,
      },
    }));

    expect(html).toContain('data-panel="usage"');
    expect(html).toContain("1,148,910");
    expect(html).toContain("709");
    expect(html).toContain("Claude Haiku 4.5");
    expect(html).toContain("8");
    expect(html).toContain("implement");
  });

  test("renders empty usage state when cost summary and quota are missing", () => {
    expect(() => renderOverview(fixture({ costSummary: undefined, quota: undefined }))).not.toThrow();

    const html = renderOverview(fixture({ costSummary: undefined, quota: undefined }));

    expect(html).toContain('data-panel="usage"');
    expect(html).toContain("暂无用量数据");
  });
});
