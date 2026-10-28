import { describe, expect, it } from "vitest";
import { aggregateOverviewBase } from "../../src/server/state-snapshot-aggregates.js";
import type { DashboardState, ProjectSnapshot } from "../../src/server/state.js";

function state(overrides: Partial<DashboardState>): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
    systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}
const flow = (flowId: string, updatedAt: number): DashboardState["flows"][number] =>
  ({ flowId, requirement: flowId, stage: "done", status: "verified", agentActive: false, pid: 1, host: "h", startedAt: 1, updatedAt, history: [], light: "green" }) as DashboardState["flows"][number];

const snaps: ProjectSnapshot[] = [
  { id: "kunpeng", name: "鲲鹏", repoPath: "/r/k", state: state({
    flows: [flow("k-1", 100), flow("k-2", 300)], flowsTotal: 40, statusCounts: { verified: 30, "rolled-back": 10 },
    plans: [{ planId: "plan-k" }] as never, plansTotal: 7,
    code: { srcLines: 1000, testLines: 500, passedLines: 1500, inFlightLines: 20, completed: 3, running: 1, rolledBack: 2 },
    health: { alerts: [{ flowId: "k-1", reason: "慢" }] as never, running: 1, healthy: 2 }, systemLight: "green",
    reinjectBacklog: { pending: 2 }, artifactsTotal: { spec: 5 },
  }) },
  { id: "proj-b", name: "项目乙", repoPath: "/r/b", state: state({
    flows: [flow("p-1", 200)], flowsTotal: 111, statusCounts: { verified: 90, "rolled-back": 17, running: 1 },
    plans: [{ planId: "plan-p" }, { planId: "plan-p2" }] as never,
    code: { srcLines: 200, testLines: 50, passedLines: 250, inFlightLines: 0, completed: 1, running: 0, rolledBack: 0 },
    health: { alerts: [], running: 0, healthy: 1 }, systemLight: "yellow", artifactsTotal: { spec: 2, design: 1 },
  }) },
];

describe("总览底座跨项目聚合（作者锁定）", () => {
  it("flows 拼接并标注项目、按 updatedAt 降序；计数求和；plans 拼接", () => {
    const a = aggregateOverviewBase(snaps);
    expect(a.flows.map((f) => f.flowId)).toEqual(["k-2", "p-1", "k-1"]);
    expect(a.flows.map((f) => f.project?.id)).toEqual(["kunpeng", "proj-b", "kunpeng"]);
    expect(a.flowsTotal).toBe(151);
    expect(a.statusCounts).toEqual({ verified: 120, "rolled-back": 27, running: 1 });
    expect(a.plans).toHaveLength(3);
    expect(a.plansTotal).toBe(9);
  });

  it("code 逐项求和；health 拼接+求和；灯取最坏；回灌与产物计数求和", () => {
    const a = aggregateOverviewBase(snaps);
    expect(a.code).toEqual({ srcLines: 1200, testLines: 550, passedLines: 1750, inFlightLines: 20, completed: 4, running: 1, rolledBack: 2 });
    expect(a.health.running).toBe(1);
    expect(a.health.healthy).toBe(3);
    expect(a.health.alerts).toHaveLength(1);
    expect((a.health.alerts[0] as { project?: { id: string } }).project?.id).toBe("kunpeng");
    expect(a.systemLight).toBe("yellow");
    expect(a.reinjectBacklog).toEqual({ pending: 2 });
    expect(a.artifactsTotal).toEqual({ spec: 7, design: 1 });
    expect(aggregateOverviewBase([snaps[1]!, { ...snaps[0]!, state: state({ systemLight: "red" }) }]).systemLight).toBe("red");
  });

  it("空快照列表 → 全零底座", () => {
    const a = aggregateOverviewBase([]);
    expect(a.flows).toEqual([]);
    expect(a.flowsTotal).toBe(0);
    expect(a.statusCounts).toEqual({});
    expect(a.plansTotal).toBe(0);
    expect(a.code.srcLines).toBe(0);
    expect(a.health).toEqual({ alerts: [], running: 0, healthy: 0 });
    expect(a.systemLight).toBe("green");
    expect(a.reinjectBacklog).toBeUndefined();
    expect(a.artifactsTotal).toBeUndefined();
  });
});