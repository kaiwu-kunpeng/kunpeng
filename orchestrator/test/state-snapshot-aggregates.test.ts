import { describe, expect, test } from "vitest";
import {
  aggregateBlockers,
  aggregateHumanGates,
} from "../src/server/state-snapshot-aggregates.js";
import type { DashboardState, ProjectSnapshot } from "../src/server/state.js";

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

function snapshot(id: string, overrides: Partial<DashboardState> = {}): ProjectSnapshot {
  return {
    id,
    name: `Project ${id}`,
    repoPath: `/projects/${id}`,
    state: state(overrides),
  };
}

describe("state snapshot attention aggregates", () => {
  test("returns empty arrays for an empty snapshot list", () => {
    expect(aggregateHumanGates([])).toEqual([]);
    expect(aggregateBlockers([])).toEqual([]);
  });

  test("preserves a single project's gates and blockers", () => {
    const gate = { what: "合并主干", detail: "等待人工确认", flowId: "flow-single-gate" };
    const blocker = { flowId: "flow-single-blocker", stage: "verify", reason: "验收未通过" };
    const only = snapshot("only", { humanGates: [gate], blockers: [blocker] });

    expect(aggregateHumanGates([only])).toEqual([gate]);
    expect(aggregateBlockers([only])).toEqual([blocker]);
  });

  test("includes human gates from a non-first project", () => {
    const secondProjectGate = {
      what: "发布生产环境",
      detail: "等待负责人放行",
      flowId: "flow-second-gate",
    };
    const snapshots = [
      snapshot("first", { humanGates: [] }),
      snapshot("second", { humanGates: [secondProjectGate] }),
    ];

    expect(aggregateHumanGates(snapshots)).toContainEqual(secondProjectGate);
  });

  test("includes blockers from a non-first project", () => {
    const secondProjectBlocker = {
      flowId: "flow-second-blocker",
      stage: "implement",
      reason: "依赖尚未就绪",
    };
    const snapshots = [
      snapshot("first", { blockers: [] }),
      snapshot("second", { blockers: [secondProjectBlocker] }),
    ];

    expect(aggregateBlockers(snapshots)).toContainEqual(secondProjectBlocker);
  });
});
