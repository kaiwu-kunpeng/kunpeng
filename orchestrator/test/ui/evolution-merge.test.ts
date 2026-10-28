import { describe, expect, test } from "vitest";

import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { renderEvolution } from "../../src/server/ui/views/evolution.js";

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
    evolution: {
      lastRunText: "上次巡检 @123",
      pendingCount: 0,
      proposals: [],
      regression: { holdout: 0, optimization: 0 },
      approvedCount: 0,
      upgrades: [],
    },
    ...overrides,
  };
}

describe("merged evolution view", () => {
  test("renders eval report action on evidence-backed proposal rows", () => {
    const html = renderEvolution(fixture({
      evolution: {
        lastRunText: "上次巡检 @123",
        pendingCount: 1,
        proposals: [
          {
            id: "proposal-a",
            status: "draft",
            summary: "有证据的提案",
            hasEvidence: true,
            holdoutPassK: 0.9,
          },
        ],
        regression: { holdout: 0, optimization: 0 },
        approvedCount: 0,
        upgrades: [],
      },
    }));

    expect(html).toContain('data-action="eval-report"');
    expect(html).toContain('data-id="proposal-a"');
    expect(html).toContain("差分报告");
  });

  test("renders verified upgrade records with changes and evidence", () => {
    const html = renderEvolution(fixture({
      evolution: {
        lastRunText: "上次巡检 @123",
        pendingCount: 0,
        proposals: [],
        regression: { holdout: 0, optimization: 0 },
        approvedCount: 0,
        upgrades: [
          {
            id: "u1",
            summary: "s",
            changes: [{ target: "conventions", text: "铁律X" }],
            holdoutPassK: 0.9,
            delta: 0.1,
          },
        ],
      },
    }));

    expect(html).toContain("applied"); // 升级记录进活动时间线
    expect(html).toContain("铁律X");
    expect(html).toContain("holdout 90%");
  });

  test("removes the evolution curve route from routed chrome", () => {
    const state = fixture();
    const sidebar = renderSidebar(state, "evolution", {});
    const fragment = renderViewFragment(state, "#/evolution-curve");

    expect(sidebar).not.toContain("自进化曲线");
    expect(sidebar).not.toContain("#/evolution-curve");
    expect(fragment).not.toContain("自进化曲线");
  });
});
