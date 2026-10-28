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
      completed: 7,
      running: 2,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 2, healthy: 2 },
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("renderOverview module status panel", () => {
  test("renders module status grouped by category with rollup and wiring details", () => {
    const html = renderOverview(fixture({
      moduleStatus: {
        modules: [
          {
            id: "m1",
            name: "自进化循环",
            category: "research-loop",
            light: "green",
            wired: true,
            lastActivity: { at: 1, agoText: "2分钟前", summary: "x" },
          },
          {
            id: "m2",
            name: "通讯总机",
            category: "comms",
            light: "idle",
            wired: false,
          },
          {
            id: "m3",
            name: "合并门",
            category: "governance",
            light: "yellow",
            wired: true,
            heartbeat: { online: true, detail: "心跳正常" },
          },
        ],
        rollup: { green: 1, yellow: 1, red: 0, idle: 1 },
        generatedAt: 1,
      },
    }));

    expect(html).toContain('data-panel="modules"');
    expect(html).toContain("模块运行状态");
    expect(html).toContain("自进化循环");
    expect(html).toContain("通讯总机");
    expect(html).toContain("合并门");
    expect(html).toContain("研发循环");
    expect(html).toContain("绿 1");
    expect(html).toContain("黄 1");
    expect(html).toContain("闲 1");
    expect(html).toContain("2分钟前");
    expect(html).toContain("心跳正常");
    expect(html).toContain("未接线");
  });

  test("renders usage determinism, saved LLM calls, and quota limit warnings", () => {
    const html = renderOverview(fixture({
      costSummary: {
        totalStages: 10,
        llmStages: 4,
        deterministicStages: 6,
        totalTokens: 12345,
        determinismRatio: 0.6,
        savedLlmCalls: 7,
        tokensByStage: { spec: 5000, impl: 7345 },
      },
      quota: {
        accounts: [
          { id: "acct-a", used: 100, limit: 100, models: [{ model: "opus", calls: 3 }] },
          { id: "acct-b", used: 5, limit: 50, models: [] },
        ],
        total: 105,
      },
    }));

    expect(html).toContain("确定性 60%");
    expect(html).toContain("省下 LLM 调用 7 次");
    expect(html).toContain("账号 acct-a 已达限额");
    expect(html).not.toContain("账号 acct-b 已达限额");
  });

  test("renders module empty state when module status is missing", () => {
    const html = renderOverview(fixture({ moduleStatus: undefined }));

    expect(html).toContain('data-panel="modules"');
    expect(html).toContain("暂无模块数据");
  });
});
