import { describe, expect, test } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState } from "../../src/server/state.js";

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
    ...overrides,
  };
}

describe("renderOverview truth panels", () => {
  test("renders main and activity truth panels", () => {
    const html = renderOverview(fixture({
      main: {
        commit: "e2073ca",
        subject: "修 ENAMETOOLONG",
        committedText: "8 分钟前",
        mergedPlans: 25,
        staleBranches: 25,
      },
      activity: {
        total: 128,
        verified: 126,
        rolledBack: 2,
        successRate: 126 / 128,
        recent: [
          {
            flowId: "plan-mqgx7fe2",
            status: "verified",
            stage: "done",
            updatedAt: 1,
            agoText: "12 分钟前",
          },
        ],
      },
    }));

    expect(html).toContain('data-panel="main"');
    expect(html).toContain("e2073ca");
    expect(html).toContain("修 ENAMETOOLONG");
    expect(html).toContain("8 分钟前");
    expect(html).toContain("25");
    expect(html).toContain('data-panel="activity"');
    expect(html).toContain("128");
    expect(html).toContain("98%");
    expect(html).toContain('data-flow="plan-mqgx7fe2"');
    expect(html).toContain("plan-mqgx7fe2");
  });

  test("tolerates missing main and activity truth", () => {
    expect(() => renderOverview(fixture({ main: undefined, activity: undefined }))).not.toThrow();

    const html = renderOverview(fixture({ main: undefined, activity: undefined }));

    expect(html.includes("非 git 仓库") || html.includes("暂无活动数据")).toBe(true);
  });
});
