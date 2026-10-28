import { describe, expect, it } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

function state(overrides: Partial<DashboardState>): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
    systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}

describe("收件箱卡片标等级：名称与含义来自分级表（作者锁定）", () => {
  it("L3 卡片印「L3 · 对外可见但可逆」并带含义 title；L4 卡片印硬门名称且二次确认文案引用表", () => {
    const html = renderReviewInbox(state({
      reviewQueue: [
        { projectId: "p", projectName: "P", kind: "merge", id: "f-1", title: "合并", detail: "d",
          decision: { action: "merge-main", blastRadius: "L3", evidence: "e" } },
        { projectId: "p", projectName: "P", kind: "release", id: "rel-1", title: "rel", detail: "b",
          decision: { action: "confirm-release", blastRadius: "L4", evidence: "b" } },
        { projectId: "p", projectName: "P", kind: "ops-gate", id: "og-1", title: "pb", detail: "r",
          decision: { action: "ops-gate-approve", blastRadius: "L2", evidence: "loop x" } },
      ],
    }));
    expect(html).toContain('data-kp-blast="L3" title="命中 C5 第三类（对外发布或操控第三方登录态）但可逆；证据须为真实遥测或人工产出">L3 · 对外可见但可逆</span>');
    expect(html).toContain('data-kp-blast="L4" title="命中 C5 第三类且不可逆或花钱；硬门，二次确认">L4 · 对外可见且不可逆或花钱</span>');
    expect(html).toContain('data-kp-blast="L2" title="可逆、范围内、不花钱的自动改动（含走合并门的合并）">L2 · 有界自动</span>');
    expect(html).toContain('data-kp-confirm="L4 对外可见且不可逆或花钱：命中 C5 第三类且不可逆或花钱；硬门，二次确认，确认批准？"');
    expect(html).not.toContain("爆炸半径 L3");
  });
});