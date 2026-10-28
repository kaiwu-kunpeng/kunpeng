import { describe, expect, test } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState, FlowWithLight } from "../../src/server/state.js";

// 回归锁:总览「待我处理」收件箱不得把 rolled-back(已自愈回滚)流当成可操作失败卡。
// 回滚=系统已自愈(state.ts 系统灯语义),只该留在「失败复盘」面板看证据,不该出现「重跑」按钮。
// 真·未恢复失败(crashed)才进收件箱。详见 action-home.ts / review-inbox 的一致语义。

function flow(
  overrides: Partial<FlowWithLight> & Pick<FlowWithLight, "flowId" | "status" | "updatedAt">,
): FlowWithLight {
  return {
    flowId: overrides.flowId,
    requirement: overrides.requirement ?? overrides.flowId,
    stage: overrides.stage ?? "done",
    status: overrides.status,
    agentActive: false,
    startedAt: overrides.startedAt ?? 1,
    updatedAt: overrides.updatedAt,
    history: overrides.history ?? [{ stage: overrides.stage ?? "done", at: overrides.updatedAt }],
    light: overrides.light ?? "green",
    ...(overrides.blocker !== undefined ? { blocker: overrides.blocker } : {}),
    ...(overrides.planId !== undefined ? { planId: overrides.planId } : {}),
    ...(overrides.project !== undefined ? { project: overrides.project } : {}),
  };
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
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
    ...overrides,
  };
}

describe("总览「待我处理」收件箱排除已回滚流", () => {
  const html = renderOverview(fixture({
    flows: [
      flow({ flowId: "flow-rolledback-x", status: "rolled-back", updatedAt: 20, blocker: "验收未过" }),
      flow({ flowId: "flow-crashed-y", status: "crashed", updatedAt: 30, blocker: "进程崩溃" }),
    ],
  }));

  test("rolled-back 流不得渲染成收件箱「重跑」卡片", () => {
    expect(html).not.toContain('data-action="rerun-flow" data-flow="flow-rolledback-x"');
  });

  test("crashed 流(真·未恢复失败)仍进收件箱并带「重跑」按钮", () => {
    expect(html).toContain('data-action="rerun-flow" data-flow="flow-crashed-y"');
  });

  test("rolled-back 流仍保留在「失败复盘」面板可看证据", () => {
    expect(html).toContain('data-panel="failures"');
    expect(html).toContain('data-action="evidence" data-flow="flow-rolledback-x"');
  });
});