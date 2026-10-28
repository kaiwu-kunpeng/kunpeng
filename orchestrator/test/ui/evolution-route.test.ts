import { describe, expect, test } from "vitest";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { clientScript } from "../../src/server/ui/client.js";
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
    evolution: {
      lastRunText: "上次巡检 @123",
      pendingCount: 1,
      proposals: [],
      regression: { holdout: 0, optimization: 0 },
      approvedCount: 0,
    },
    ...overrides,
  };
}

describe("evolution route wiring", () => {
  test("renderViewFragment routes evolution to renderEvolution", () => {
    const html = renderViewFragment(fixture(), "#/evolution");

    expect(html).toContain('data-panel="proposals"');
    expect(html).not.toContain("在跑什么");
  });

  test("renderSidebar exposes evolution as a routed link", () => {
    const html = renderSidebar(fixture(), "evolution", {});

    expect(html).toContain('href="#/evolution"');
  });

  test("client normalizeHash allows the evolution route", () => {
    expect(clientScript).toContain("#/evolution");
  });
});
