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

describe("renderEvolution", () => {
  test("renders evolution panels and proposal evidence states", () => {
    const html = renderEvolution(fixture({
      evolution: {
        proposals: [
          {
            id: "proposal-a",
            status: "pending",
            summary: "有证据的提案",
            hasEvidence: true,
            holdoutPassK: 0.8,
          },
          {
            id: "proposal-b",
            status: "pending",
            summary: "无证据的提案",
            hasEvidence: false,
          },
        ],
        regression: { holdout: 3, optimization: 12 },
        approvedCount: 5,
        upgrades: [{ id: "u1", summary: "升级A", changes: [{ target: "conventions", text: "铁律A" }] }],
        pendingCount: 2,
        lastRunText: "上次巡检 @123",
      },
    }));

    expect(html).toContain("evo-bento");
    expect(html).toContain('data-panel="proposals"');
    expect(html.match(/data-proposal=/g)).toHaveLength(2);
    expect(html).toContain("✓ tested"); // hasEvidence 提案 → tested 证据态
    expect(html).toContain("○ untested"); // 无证据提案 → untested
    expect(html).toContain("有证据的提案");
    expect(html).toContain("无证据的提案");
    expect(html).toContain("铁律A"); // 升级改动文本（活动区）
    expect(html).toContain('href="#/inbox"');
  });

  test("tolerates missing evolution data", () => {
    expect(() => renderEvolution(fixture({ evolution: undefined }))).not.toThrow();

    const html = renderEvolution(fixture({ evolution: undefined }));

    expect(html).toContain("暂无自进化数据");
  });
});
