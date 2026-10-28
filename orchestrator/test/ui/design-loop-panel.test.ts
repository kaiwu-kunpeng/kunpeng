import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { clientScript } from "../../src/server/ui/client.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
    branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}

describe("设计 Loop 面板", () => {
  test("项目设计 tab 含设计 Loop 面板", () => {
    const html = renderViewFragment(fixture(), "#/project/kunpeng/design", { projectName: "kunpeng" });
    expect(html).toContain("设计 Loop");
    expect(html).toContain('data-panel="design-loop"');
    expect(html).toContain('data-action="design-loop"');
    expect(html).toContain("data-dl-brief");
    expect(html).toContain("data-dl-seed");
    expect(html).toContain('id="design-loop-out"');
  });

  test("client 接线:design-loop handler 调 /api/design-loop", () => {
    expect(clientScript).toContain('action === "design-loop"');
    expect(clientScript).toContain("/api/design-loop");
    expect(clientScript).toContain("投资门");
  });
});
