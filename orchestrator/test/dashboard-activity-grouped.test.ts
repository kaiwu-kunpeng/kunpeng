import { expect, test } from "vitest";
import {
  buildActivityByProject,
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

function state(flows: FlowWithLight[], activity?: DashboardState["activity"]): DashboardState {
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

test("buildActivityByProject returns a group for every project and orders active projects first", () => {
  const now = 1_000_000;
  const aFlows = [
    flow("a-new", now - 30_000, "verified"),
    flow("a-old", now - 180_000, "rolled-back"),
  ];
  const bFlows = [
    flow("b-old", now - 600_000, "verified"),
  ];
  const cFlows: FlowWithLight[] = [];
  const snapshots: ProjectSnapshot[] = [
    {
      id: "b",
      name: "Beta",
      repoPath: "/b",
      state: state(bFlows, undefined),
    },
    {
      id: "c",
      name: "Calm",
      repoPath: "/c",
      state: state(cFlows, undefined),
    },
    {
      id: "a",
      name: "Alpha",
      repoPath: "/a",
      state: state(aFlows, { total: 2, verified: 1, rolledBack: 1, successRate: 0.5, recent: [] }),
    },
  ];
  const originalOrder = snapshots[0].state.flows.map((item) => item.flowId);

  const result = buildActivityByProject(snapshots, now);

  expect(result).toHaveLength(3);
  expect(result.map((group) => group.id)).toEqual(["a", "b", "c"]);
  expect(result.map((group) => group.name)).toEqual(["Alpha", "Beta", "Calm"]);
  expect(result.every((group) => group.recent.length <= 4)).toBe(true);
  expect(result[0].recent.map((item) => item.updatedAt)).toEqual([now - 30_000, now - 180_000]);
  expect(result[0].recent.every((item) => item.agoText.length > 0)).toBe(true);
  expect(result[1].recent.every((item) => item.agoText.length > 0)).toBe(true);
  expect(result[2].recent).toEqual([]);
  expect(result[2].total).toBe(0);
  expect(result[0].total).toBe(2);
  expect(result[0].successRate).toBe(0.5);
  expect(result[1].total).toBe(1);
  expect(result[1].verified).toBe(1);
  expect(result[1].rolledBack).toBe(0);
  expect(result[1].successRate).toBe(1);
  expect(snapshots[0].state.flows.map((item) => item.flowId)).toEqual(originalOrder);
});

test("buildActivityByProject caps each project recent list at four sorted flows", () => {
  const now = 2_000_000;
  const flows = [
    flow("oldest", now - 500_000, "running"),
    flow("newest", now - 10_000, "verified"),
    flow("middle-2", now - 200_000, "rolled-back"),
    flow("middle-1", now - 100_000, "verified"),
    flow("middle-3", now - 300_000, "running"),
  ];

  const result = buildActivityByProject(
    [{ id: "busy", name: "Busy", repoPath: "/busy", state: state(flows, undefined) }],
    now,
  );

  expect(result[0].recent.map((item) => item.flowId)).toEqual(["newest", "middle-1", "middle-2", "middle-3"]);
  expect(result[0].recent).toHaveLength(4);
  expect(result[0].total).toBe(5);
  expect(result[0].successRate).toBe(2 / 3);
  expect(flows.map((item) => item.flowId)).toEqual(["oldest", "newest", "middle-2", "middle-1", "middle-3"]);
});
