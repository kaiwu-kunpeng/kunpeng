import { expect, test } from "vitest";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import type { DashboardState } from "../../src/server/state.js";

const state: DashboardState = {
  agents: 0, flows: [], running: [], blockers: [], artifacts: {},
  statusCounts: {}, systemLight: "green", agentAssignments: [],
  patrol: { pendingCount: 0, lastRunText: "" }, designCandidates: [],
  health: { alerts: [], running: 0, healthy: 0 },
  code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },

  humanGates: [],
  branches: ["kp/demo-project"],
  plans: [],
};

test("renderSidebar renders every provided project in the project section", () => {
  const html = renderSidebar(state, "overview", {
    projects: [
      { id: "kunpeng", name: "鲲鹏（本体）" },
      { id: "repo", name: "DemoTravel.ai" },
    ],
  });

  expect(html).toContain('href="#/project/kunpeng"');
  expect(html).toContain("鲲鹏（本体）");
  expect(html).toContain('href="#/project/repo"');
  expect(html).toContain("DemoTravel.ai");
  expect(html).toContain("接管新项目");
});

test("renderSidebar escapes project names from the projects list", () => {
  const html = renderSidebar(state, "overview", {
    projects: [{ id: "unsafe", name: "<script>alert(1)</script>" }],
  });

  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("renderSidebar keeps the single project fallback when projects is omitted", () => {
  const html = renderSidebar(state, "overview", { projectName: "kunpeng", projectId: "kunpeng" });

  expect(html).toContain('href="#/project/kunpeng"');
  expect(html.match(/href="#\/project\/kunpeng"/g)).toHaveLength(1);
  expect(html).toContain("接管新项目");
});
