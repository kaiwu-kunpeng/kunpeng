import { expect, test } from "vitest";
import {
  aggregateCrossProjectActivity,
  type DashboardState,
  type FlowWithLight,
  type ProjectSnapshot,
} from "../src/server/state.js";

function flow(flowId: string, updatedAt: number, status: FlowWithLight["status"]): FlowWithLight {
  return {
    flowId,
    requirement: `${flowId} requirement`,
    stage: "done",
    status,
    agentActive: false,
    startedAt: updatedAt - 10_000,
    updatedAt,
    history: [],
    light: "green",
  };
}

function state(flows: FlowWithLight[], activity: DashboardState["activity"]): DashboardState {
  return {
    agents: 1,
    flows,
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
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    activity,
  };
}

test("aggregateCrossProjectActivity sums activity and tags recent flows by project", () => {
  const now = 1_000_000;
  const kunpengFlows = [
    flow("kp-new", now - 60_000, "verified"),
    flow("kp-old", now - 600_000, "rolled-back"),
  ];
  const repoFlows = [
    flow("repo-new", now - 30_000, "verified"),
    flow("repo-old", now - 900_000, "rolled-back"),
  ];
  const snapshots: ProjectSnapshot[] = [
    {
      id: "kunpeng",
      name: "鲲鹏",
      repoPath: "/x",
      state: state(kunpengFlows, { total: 2, verified: 1, rolledBack: 1, successRate: 0.5, recent: [] }),
    },
    {
      id: "repo",
      name: "DemoTravel.ai",
      repoPath: "/y",
      state: state(repoFlows, { total: 2, verified: 1, rolledBack: 1, successRate: 0.5, recent: [] }),
    },
  ];

  const result = aggregateCrossProjectActivity(snapshots, now);

  expect(result.total).toBe(4);
  expect(result.verified).toBe(2);
  expect(result.rolledBack).toBe(2);
  expect(result.successRate).toBe(0.5);
  expect(result.recent).toHaveLength(4);
  expect(result.recent.length).toBeLessThanOrEqual(8);
  expect(result.recent.map((item) => item.flowId)).toEqual(["repo-new", "kp-new", "kp-old", "repo-old"]);
  expect(result.recent.map((item) => item.updatedAt)).toEqual([
    now - 30_000,
    now - 60_000,
    now - 600_000,
    now - 900_000,
  ]);
  expect(result.recent.find((item) => item.flowId === "kp-new")?.project).toEqual({ id: "kunpeng", name: "鲲鹏" });
  expect(result.recent.find((item) => item.flowId === "repo-new")?.project).toEqual({ id: "repo", name: "DemoTravel.ai" });
  expect(result.recent[0].agoText).toBe("刚刚");
  expect(result.recent[1].agoText).toBe("1 分钟前");
  expect(result.recent[3].project?.name).toBe("DemoTravel.ai");
});

test("aggregateCrossProjectActivity keeps flows from snapshots without activity but skips their counts", () => {
  const now = 2_000_000;
  const snapshots: ProjectSnapshot[] = [
    {
      id: "counted",
      name: "Counted",
      repoPath: "/counted",
      state: state(
        [flow("counted-flow", now - 120_000, "verified")],
        { total: 1, verified: 1, rolledBack: 0, successRate: 1, recent: [] },
      ),
    },
    {
      id: "missing",
      name: "Missing Activity",
      repoPath: "/missing",
      state: state([flow("missing-flow", now - 30_000, "rolled-back")], undefined),
    },
  ];

  const result = aggregateCrossProjectActivity(snapshots, now);

  expect(result.total).toBe(1);
  expect(result.verified).toBe(1);
  expect(result.rolledBack).toBe(0);
  expect(result.successRate).toBe(1);
  expect(result.recent.map((item) => item.flowId)).toEqual(["missing-flow", "counted-flow"]);
  expect(result.recent[0].project).toEqual({ id: "missing", name: "Missing Activity" });
});

test("aggregateCrossProjectActivity uses a success rate of 1 when no counted flows finished", () => {
  const result = aggregateCrossProjectActivity(
    [{ id: "only", name: "Only", repoPath: "/only", state: state([flow("f1", 100, "verified")], undefined) }],
    200,
  );

  expect(result.total).toBe(0);
  expect(result.verified).toBe(0);
  expect(result.rolledBack).toBe(0);
  expect(result.successRate).toBe(1);
  expect(result.recent).toHaveLength(1);
});
