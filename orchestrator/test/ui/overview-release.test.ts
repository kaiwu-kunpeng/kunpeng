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
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("renderOverview release panel", () => {
  test("renders release artifacts with summaries and rollback status", () => {
    const html = renderOverview(fixture({
      artifacts: {
        release: [
          { id: "rel-1", kind: "release", status: "verified", summary: "发布 v1 通过" },
          { id: "rel-2", kind: "release", status: "rolled-back", summary: "发布 v2 验证失败" },
        ],
      },
    }));

    expect(html).toContain('data-panel="release"');
    expect(html).toContain("rel-1");
    expect(html).toContain("rel-2");
    expect(html).toContain("发布 v1 通过");
    expect(html).toContain("rolled-back");
  });

  test("renders empty state when release artifacts are missing", () => {
    expect(() => renderOverview(fixture({ artifacts: {} }))).not.toThrow();

    const html = renderOverview(fixture({ artifacts: {} }));

    expect(html).toContain("暂无发布记录");
  });
});
