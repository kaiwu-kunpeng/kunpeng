import { describe, expect, test } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState, FlowWithLight } from "../../src/server/state.js";

function flow(id: string, requirement: string, stage: FlowWithLight["stage"], planId?: string): FlowWithLight {
  return {
    flowId: id,
    requirement,
    stage,
    status: "running",
    agentActive: true,
    startedAt: 1,
    updatedAt: 2,
    history: [{ stage, at: 2 }],
    light: "green",
    ...(planId ? { planId } : {}),
  };
}

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  const running = [
    flow("flow-overview-a", "段一 · 总览视图", "implement", "kunpeng"),
    flow("flow-overview-b", "客户端路由", "verify", "demo-travel"),
  ];

  return {
    agents: 3,
    flows: running,
    running,
    blockers: [],
    humanGates: [
      { what: "合并主干", detail: "kp/a -> main", flowId: "gate-a" },
      { what: "批准提案", detail: "proposal-b", flowId: "gate-b" },
      { what: "对外发布", detail: "release-c", flowId: "gate-c" },
    ],
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
      completed: 7,
      running: 2,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 2, healthy: 2 },
    ...overrides,
  };
}

describe("renderOverview", () => {
  test("renders green overview KPIs and running flows without business action buttons", () => {
    const html = renderOverview(fixture());

    expect(html).toContain("系统正常运行");
    expect(html).toContain("一切安好");
    expect(html).toContain("在跑流");
    expect(html).toContain(">2<");
    expect(html).toContain("待我处理");
    expect(html).toContain(">3<");
    expect(html).toContain("kunpeng");
    expect(html).toContain("flow-overview-a");
    expect(html).toContain("class=\"kpi pri\"");
    expect(html).toContain("class=\"kpi wrn\"");
    expect(html).toContain("class=\"kpi suc\"");
    expect(html).toContain("class=\"kpi neu\"");
    expect(html).not.toContain("启动新工作");
    expect(html).not.toContain("选设计");
    expect(html).not.toContain("生成设计代码");
  });

  test("renders red health copy", () => {
    const html = renderOverview(fixture({ systemLight: "red" }));

    expect(html).toContain("有未解决问题");
  });
});
