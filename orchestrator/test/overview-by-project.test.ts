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

function activityState(recent: NonNullable<DashboardState["activity"]>["recent"]): DashboardState {
  return fixture({
    activity: {
      total: recent.length,
      verified: recent.length,
      rolledBack: 0,
      successRate: 1,
      recent,
    },
  });
}

test("renderOverview renders project tags on recent activity and tolerates old items", () => {
  const html = renderOverview(activityState([
    {
      flowId: "flow-kunpeng",
      status: "running",
      stage: "implement",
      updatedAt: 2,
      agoText: "刚刚",
      project: { id: "kunpeng", name: "鲲鹏" },
    },
    {
      flowId: "flow-repo",
      status: "verified",
      stage: "done",
      updatedAt: 1,
      agoText: "1 分钟前",
      project: { id: "repo", name: "DemoTravel.ai" },
    },
  ]));

  expect(html).toContain("鲲鹏");
  expect(html).toContain("DemoTravel.ai");

  expect(() => renderOverview(activityState([
    {
      flowId: "legacy-flow",
      status: "running",
      stage: "spec",
      updatedAt: 1,
      agoText: "刚刚",
    },
  ]))).not.toThrow();

  const legacyHtml = renderOverview(activityState([
    {
      flowId: "legacy-flow",
      status: "running",
      stage: "spec",
      updatedAt: 1,
      agoText: "刚刚",
    },
  ]));
  expect(legacyHtml).not.toContain('<span class="tag"></span>');
});

test("/api/view overview uses cross-project aggregated activity", async () => {
  const stateDir = makeTempDir("kp-overview-state-");
  const kunpengParent = makeTempDir("kp-overview-kunpeng-");
  const repoParent = makeTempDir("kp-overview-repo-");
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
    expect(html).toContain("鲲鹏");
    expect(html).toContain("DemoTravel.ai");
  } finally {
    srv.close();
  }
});
