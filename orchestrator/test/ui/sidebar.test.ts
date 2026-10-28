import { expect, test } from "vitest";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import type { DashboardState } from "../../src/server/state.js";

const state: DashboardState = {
  agents: 0, flows: [], running: [], blockers: [], artifacts: {},
  statusCounts: {}, systemLight: "green", agentAssignments: [],
  patrol: { pendingCount: 0, lastRunText: "" }, designCandidates: [],
  health: { alerts: [], running: 0, healthy: 0 },
  code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },

  humanGates: [{ what: "merge", detail: "needs approval", flowId: "flow-1" }],
  branches: ["kp/demo-project"],
  plans: [],
};

test("renderSidebar renders brand, navigation, active overview, and inbox badge", () => {
  const html = renderSidebar(state, "overview");

  expect(html).toContain("鹏");
  expect(html).toContain("鲲鹏");
  expect(html).toContain("总览");
  expect(html).toContain("待我处理");
  expect(html).not.toContain("style=");
  expect(html).toContain("<svg");
  expect(html).toMatch(/class="nav-item active"[\s\S]*?<span class="lbl">总览<\/span>/);
  expect(html).toContain(`<span class="badge">${state.humanGates.length}</span>`);
});

test("renderSidebar moves active state to inbox", () => {
  const html = renderSidebar(state, "inbox");

  expect(html).toMatch(/class="nav-item active"[\s\S]*?<span class="lbl">待我处理<\/span>/);
  expect(html).not.toMatch(/class="nav-item active"[\s\S]*?<span class="lbl">总览<\/span>/);
});

test("renderSidebar uses reviewQueue count for inbox badge when present", () => {
  const html = renderSidebar(
    {
      ...state,
      humanGates: [],
      reviewQueue: [
        { projectId: "alpha", projectName: "Alpha", kind: "merge", title: "One", id: "one", detail: "" },
        { projectId: "alpha", projectName: "Alpha", kind: "release", title: "Two", id: "two", detail: "" },
        { projectId: "beta", projectName: "Beta", kind: "connector", title: "Three", id: "three", detail: "" },
        { projectId: "beta", projectName: "Beta", kind: "merge", title: "Four", id: "four", detail: "" },
        { projectId: "gamma", projectName: "Gamma", kind: "release", title: "Five", id: "five", detail: "" },
      ],
    },
    "inbox",
  );

  expect(html).toContain('<span class="badge">5</span>');
});
