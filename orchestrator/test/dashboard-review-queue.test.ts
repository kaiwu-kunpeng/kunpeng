import { expect, test } from "vitest";
import { aggregateReviewQueue, type DashboardState, type ProjectSnapshot } from "../src/server/state.js";

function state(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 1,
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
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  };
}

function snapshot(id: string, name: string, dashboardState: DashboardState): ProjectSnapshot {
  return { id, name, repoPath: `/${id}`, state: dashboardState };
}

test("aggregateReviewQueue collects review items across projects in stable order", () => {
  const snapA = snapshot(
    "proj-a",
    "A",
    state({
      humanGates: [
        { what: "合并主干 kp/x → main", detail: "d", flowId: "f1" },
        { what: "批准进化提案 (人工门#2)", detail: "p1", flowId: "p1" },
      ],
      artifacts: {
        release: [{ id: "rel-a", kind: "release", status: "draft", summary: "build" }],
      },
    }),
  );
  const snapB = snapshot(
    "proj-b",
    "B",
    state({
      artifacts: {
        connector: [{ id: "conn-b", kind: "connector", status: "draft", summary: "退款" }],
        release: [{ id: "rel-b2", kind: "release", status: "verified", summary: "已确认" }],
      },
    }),
  );

  const result = aggregateReviewQueue([snapA, snapB]);

  expect(result).toHaveLength(4);
  expect(result.map((item) => ({ projectId: item.projectId, kind: item.kind, id: item.id }))).toEqual([
    { projectId: "proj-a", kind: "merge", id: "f1" },
    { projectId: "proj-a", kind: "proposal", id: "p1" },
    { projectId: "proj-a", kind: "release", id: "rel-a" },
    { projectId: "proj-b", kind: "connector", id: "conn-b" },
  ]);
  expect(result).not.toContainEqual(expect.objectContaining({ projectId: "proj-b", id: "rel-b2" }));
  expect(result.filter((item) => item.projectId === "proj-a").every((item) => item.projectName === "A")).toBe(true);
  expect(result.filter((item) => item.projectId === "proj-b").every((item) => item.projectName === "B")).toBe(true);
});

test("aggregateReviewQueue handles empty or missing review sources", () => {
  expect(aggregateReviewQueue([])).toEqual([]);
  expect(() => aggregateReviewQueue([snapshot("empty", "Empty", state())])).not.toThrow();
  expect(aggregateReviewQueue([snapshot("empty", "Empty", state())])).toEqual([]);
});
