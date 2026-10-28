import { describe, expect, test } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState, FlowWithLight } from "../../src/server/state.js";

function flow(overrides: Partial<FlowWithLight> & Pick<FlowWithLight, "flowId" | "status" | "updatedAt">): FlowWithLight {
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

describe("renderOverview failures panel", () => {
  test("renders rolled-back flows with blocker fallback and evidence actions", () => {
    const html = renderOverview(fixture({
      flows: [
        flow({
          flowId: "flow-failed-a",
          status: "rolled-back",
          updatedAt: 20,
          blocker: "验收测试未过: tsc 报错",
        }),
        flow({
          flowId: "flow-verified-c",
          status: "verified",
          updatedAt: 30,
        }),
        flow({
          flowId: "flow-failed-b",
          status: "rolled-back",
          updatedAt: 10,
        }),
      ],
    }));

    expect(html).toContain('data-panel="failures"');
    expect(html).toContain("flow-failed-a");
    expect(html).toContain("flow-failed-b");
    expect(html).not.toContain("flow-verified-c");
    expect(html).toContain("验收测试未过");
    expect(html).toContain("未记录原因");
    expect(html.match(/data-action="evidence"/g)).toHaveLength(2);
  });

  test("renders empty state when there are no rolled-back flows", () => {
    expect(() => renderOverview(fixture({
      flows: [flow({ flowId: "flow-verified-only", status: "verified", updatedAt: 1 })],
    }))).not.toThrow();

    const html = renderOverview(fixture({
      flows: [flow({ flowId: "flow-verified-only", status: "verified", updatedAt: 1 })],
    }));

    expect(html).toContain("暂无失败流");
  });
});
