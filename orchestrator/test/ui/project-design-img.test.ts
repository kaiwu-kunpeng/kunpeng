import { describe, expect, test } from "vitest";
import { renderProject } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

function fixture(candidate: DashboardState["designCandidates"][number]): DashboardState {
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
    designCandidates: [candidate],
    designSelected: undefined,
    health: { alerts: [], running: 0, healthy: 0 },
  };
}

describe("project design candidate image src", () => {
  test("renders candidate image through the previews route for the current project", () => {
    const html = renderProject(
      fixture({ index: 0, source: "house", anchor: "a1", png: "cand-0.png" }),
      "kunpeng",
      "design",
      { projectName: "鲲鹏" },
    );

    expect(html).toContain('src="/previews/kunpeng/cand-0.png"');
    expect(html).not.toContain('src="cand-0.png"');
  });

  test("uses the projectId passed to renderProject instead of a hard-coded project", () => {
    const html = renderProject(
      fixture({ index: 2, source: "repo-design", anchor: "a2", png: "cand-2.png" }),
      "repo",
      "design",
      { projectName: "Repo" },
    );

    expect(html).toContain('src="/previews/repo/cand-2.png"');
  });

  test("keeps the placeholder branch for candidates without png", () => {
    const html = renderProject(
      fixture({ index: 1, source: "empty", anchor: "a3", png: "" }),
      "kunpeng",
      "design",
      { projectName: "鲲鹏" },
    );

    expect(html).toContain('class="prev"');
    expect(html).not.toContain('class="cand-img" src="/previews/');
  });
});
