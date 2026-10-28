import { afterEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../src/project/registry.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";
import type { DashboardState } from "../src/server/state.js";
import { renderOverview } from "../src/server/ui/views/overview.js";

let cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

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

test("renderOverview groups activity by project and falls back for old state", () => {
  const html = renderOverview(fixture({
    activity: {
      total: 3,
      verified: 2,
      rolledBack: 1,
      successRate: 2 / 3,
      recent: [],
    },
    activityByProject: [
      {
        id: "kunpeng",
        name: "鲲鹏",
        total: 2,
        verified: 1,
        rolledBack: 1,
        successRate: 0.5,
        recent: [
          { flowId: "kunpeng-new", status: "running", stage: "implement", updatedAt: 2, agoText: "刚刚" },
          { flowId: "kunpeng-old", status: "verified", stage: "done", updatedAt: 1, agoText: "1 分钟前" },
        ],
      },
      {
        id: "traveler",
        name: "DemoTravel.ai",
        total: 1,
        verified: 1,
        rolledBack: 0,
        successRate: 1,
        recent: [
          { flowId: "traveler-flow", status: "verified", stage: "done", updatedAt: 3, agoText: "刚刚" },
        ],
      },
    ],
  }));

  expect(html).toContain('data-panel="activity"');
  expect((html.match(/data-project-group=/g) ?? [])).toHaveLength(2);
  expect(html).toContain("鲲鹏");
  expect(html).toContain("DemoTravel.ai");
  expect(html).toMatch(/data-project-group="kunpeng"[\s\S]*kunpeng-new[\s\S]*kunpeng-old/);
  expect(html).toMatch(/data-project-group="traveler"[\s\S]*traveler-flow/);

  const fallbackState = fixture({
    activity: {
      total: 1,
      verified: 0,
      rolledBack: 0,
      successRate: 1,
      recent: [
        { flowId: "legacy-flow", status: "running", stage: "spec", updatedAt: 1, agoText: "刚刚" },
      ],
    },
    activityByProject: undefined,
  });

  expect(() => renderOverview(fallbackState)).not.toThrow();
  const fallbackHtml = renderOverview(fallbackState);
  expect(fallbackHtml).toContain('data-panel="activity"');
  expect(fallbackHtml).toContain("legacy-flow");
  expect(fallbackHtml).not.toContain("data-project-group=");
});

test("/api/view overview feeds grouped project activity", async () => {
  const stateDir = makeTempDir("kp-overview-grouped-state-");
  const kunpengParent = makeTempDir("kp-overview-grouped-kunpeng-");
  const repoParent = makeTempDir("kp-overview-grouped-repo-");
  const kunpengRepo = join(kunpengParent, "kunpeng");
  const repoRepo = join(repoParent, "repo");
  mkdirSync(kunpengRepo);
  mkdirSync(repoRepo);

  await registerProject({ repoPath: kunpengRepo, name: "鲲鹏", stateDir, now: 1 });
  await registerProject({ repoPath: repoRepo, name: "DemoTravel.ai", stateDir, now: 2 });
  await new FlowTracker(join(kunpengRepo, ".kunpeng", "state")).start("kunpeng-flow", "do kunpeng");
  await new FlowTracker(join(repoRepo, ".kunpeng", "state")).start("repo-flow", "do repo");

  const srv = await startDashboard({ port: 0, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/view?${new URLSearchParams({ route: "#/overview" }).toString()}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect((html.match(/data-project-group=/g) ?? [])).toHaveLength(2);
    expect(html).toContain("鲲鹏");
    expect(html).toContain("DemoTravel.ai");
  } finally {
    srv.close();
  }
});
