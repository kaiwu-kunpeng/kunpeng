import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { clientScript } from "../../src/server/ui/client.js";
import { renderProject } from "../../src/server/ui/views/project.js";

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

describe("plans tab cards", () => {
  test("renders plan cards with summary, segment count, and view action", () => {
    const html = renderProject(
      fixture({
        plans: [{
          id: "plan-x",
          status: "verified",
          merged: true,
          desc: "做了X",
          summary: "第一行 · 第二行",
          segmentCount: 3,
        }],
      }),
      "kunpeng",
      "plans",
      {}
    );

    expect(html).toContain("做了X");
    expect(html).toContain("第二行");
    expect(html).toContain("3 段");
    expect(html).toContain('data-action="view-plan"');
    expect(html).toContain('data-plan="plan-x"');
  });

  test("client script includes view-plan and parses as JavaScript", () => {
    expect(clientScript).toContain("view-plan");
    expect(() => new Function(clientScript)).not.toThrow();
  });
});
