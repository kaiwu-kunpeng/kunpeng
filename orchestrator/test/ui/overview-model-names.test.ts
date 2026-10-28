import { describe, expect, test } from "vitest";
import type { DashboardState, FlowWithLight } from "../../src/server/state.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";

function flow(id: string, stage: FlowWithLight["stage"]): FlowWithLight {
  return {
    flowId: id,
    requirement: id,
    stage,
    status: "running",
    agentActive: true,
    startedAt: 1,
    updatedAt: 2,
    history: [{ stage, at: 2 }],
    light: "green",
  };
}

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  const running = [flow("flow-models", "implement")];
  return {
    agents: 2,
    flows: running,
    running,
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
      running: 1,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 1, healthy: 1 },
    ...overrides,
  };
}

describe("overview model display names", () => {
  test("renders real model names for quota calls and model token usage", () => {
    const html = renderOverview(fixture({
      costSummary: {
        totalStages: 1,
        llmStages: 1,
        deterministicStages: 0,
        totalTokens: 125300,
        determinismRatio: 0,
        savedLlmCalls: 0,
        tokensByStage: {},
        tokensByModel: { opus: 5000, low: 120000, haiku: 300 },
      },
      quota: {
        accounts: [
          { id: "acct-a", used: 11, models: [{ model: "opus", calls: 2 }, { model: "low", calls: 9 }] },
        ],
        total: 11,
      },
    }));

    expect(html).toContain("Claude Opus 4.8");
    expect(html).toContain("Codex·low");
    expect(html).toContain("Claude Haiku 4.5");
    expect(html).toContain("按模型");
    expect(html).toContain("Claude Opus 4.8 5,000 token");
    expect(html).toContain("Codex·low 9 次");
    expect(html).not.toContain("haiku 300 token");
    expect(html).not.toContain("haiku ");
  });
});
