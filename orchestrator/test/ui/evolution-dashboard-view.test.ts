import { describe, expect, test } from "vitest";

import { renderEvolution } from "../../src/server/ui/views/evolution.js";
import type { DashboardState } from "../../src/server/state.js";

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
    ...overrides,
  };
}

describe("renderEvolution dashboard", () => {
  test("renders the health dashboard metrics and trend series", () => {
    const html = renderEvolution(fixture({
      evolution: {
        proposals: [],
        regression: { holdout: 49, optimization: 196 },
        approvedCount: 1,
        pendingCount: 0,
        lastRunText: "上次巡检 @123",
        dashboard: {
          holdoutPassAt1: 0.9,
          lastDelta: 0.05,
          archiveSize: 3,
          approvedCount: 1,
          holdoutCount: 49,
          optimizationCount: 196,
          series: [{ id: "p1", pass: 0.8, delta: 0.2 }],
        },
      },
    }));

    expect(html).toContain("健康 · 多指标"); // 反 Goodhart small-multiples 健康块
    expect(html).toContain('data-panel="evo-dashboard"');
    expect(html).toContain("pass@1");
    expect(html).toContain("90%"); // holdoutPassAt1 0.9
    expect(html).toContain("+5%"); // lastDelta 0.05（适应度 Δ）
    expect(html).toContain("进化尝试"); // archive 指标（值 3 单独成元素）
    expect(html).toContain("reward-hack"); // 防刷分说明保留
    expect(html).toContain("holdout"); // holdout epoch 指标
  });

  test("health 多指标块在无 dashboard 证据时优雅降级（— 占位），提案区仍在", () => {
    const html = renderEvolution(fixture({
      evolution: {
        proposals: [],
        regression: { holdout: 0, optimization: 0 },
        approvedCount: 0,
        pendingCount: 0,
        lastRunText: "尚未巡检",
        dashboard: undefined,
      },
    }));

    expect(html).toContain('data-panel="evo-dashboard"'); // 健康块始终在（多指标设计）
    expect(html).toContain("pass@1");
    expect(html).toContain("—"); // 无 dashboard → pass@1 占位
    expect(html).toContain('data-panel="proposals"');
  });

  test("负 Δ 显示为 neg 证据态，且提案摘要被转义防 XSS", () => {
    const html = renderEvolution(fixture({
      evolution: {
        proposals: [
          { id: "p<bad>\"", status: "draft", summary: "恶意<script>", hasEvidence: false },
        ],
        regression: { holdout: 1, optimization: 1 },
        approvedCount: 0,
        pendingCount: 0,
        lastRunText: "上次巡检 @456",
        dashboard: {
          holdoutPassAt1: 0.7,
          lastDelta: -0.03,
          archiveSize: 1,
          approvedCount: 0,
          holdoutCount: 1,
          optimizationCount: 1,
          series: [],
        },
      },
    }));

    expect(html).toContain("-3%"); // 负 Δ
    expect(html).toContain("恶意&lt;script&gt;"); // summary 转义
    expect(html).toContain("p&lt;bad&gt;&quot;"); // id 转义（data-proposal / pid）
    expect(html).not.toContain("恶意<script>");
  });
});
