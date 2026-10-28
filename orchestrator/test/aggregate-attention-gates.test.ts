import { expect, test } from "vitest";
import { aggregateBlockers, aggregateHumanGates, type DashboardState, type ProjectSnapshot } from "../src/server/state.js";

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

// 第一个项目为空、门/阻塞落在第二个（非首）项目——正是线上 attention 徽标数得到、页面数不到的场景。
const first = snapshot("kunpeng", "kunpeng", state({ humanGates: [], blockers: [] }));
const second = snapshot(
  "demo-travel",
  "demo-travel",
  state({
    humanGates: [
      { what: "运营 loop 对外推送", detail: "IndexNow 待发队列，等人批 flush", flowId: "loop-push-1" },
      { what: "运营 loop 波前护栏", detail: "护栏拦截，等人工放行", flowId: "loop-guard-1" },
    ],
    blockers: [{ flowId: "blk-1", stage: "implement", reason: "误触发：被当作需求文本" }],
  }),
);

test("aggregateHumanGates 跨项目合并——非首个项目的人工门也要被收进来", () => {
  const gates = aggregateHumanGates([first, second]);
  expect(gates).toHaveLength(2);
  expect(gates.map((g) => g.what)).toEqual(["运营 loop 对外推送", "运营 loop 波前护栏"]);
});

test("aggregateBlockers 跨项目合并——非首个项目的阻塞也要被收进来", () => {
  const blockers = aggregateBlockers([first, second]);
  expect(blockers).toHaveLength(1);
  expect(blockers[0]?.reason).toBe("误触发：被当作需求文本");
});

test("单项目时聚合结果与该项目自身数组等价（不改单项目行为）", () => {
  const solo = snapshot("solo", "solo", state({
    humanGates: [{ what: "合并主干 kp/x → main", detail: "d", flowId: "f1" }],
    blockers: [{ flowId: "b", stage: "verify", reason: "等待输入" }],
  }));
  expect(aggregateHumanGates([solo])).toEqual(solo.state.humanGates);
  expect(aggregateBlockers([solo])).toEqual(solo.state.blockers);
});

test("空快照集返回空数组", () => {
  expect(aggregateHumanGates([])).toEqual([]);
  expect(aggregateBlockers([])).toEqual([]);
});