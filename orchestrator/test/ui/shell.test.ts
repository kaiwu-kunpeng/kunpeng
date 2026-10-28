import { describe, expect, test } from "vitest";
import { renderShell } from "../../src/server/ui/shell.js";
import type { DashboardState } from "../../src/server/state.js";

const fixtureState: DashboardState = {
  agents: 1,
  flows: [],
  running: [],
  blockers: [],
  humanGates: [],
  artifacts: {},
  branches: ["kp/shell-route"],
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
};

describe("renderShell", () => {
  test("renders the full app shell with theme, sidebar, overview, and client script", () => {
    const html = renderShell(fixtureState);

    expect(html).toContain("<!DOCTYPE");
    expect(html).toContain("--primary:#8D4B00");
    expect(html).toContain('class="rail"');
    expect(html).toContain('href="#/overview"');
    expect(html).toMatch(/系统正常运行|有未解决问题/);
    expect(html).toContain('<div id="view"');
    expect(html).toContain("<script>");
    expect(html).toContain("#/overview");
  });
});
