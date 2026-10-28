import { describe, expect, it } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { flowBlockers } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

const flows = [
  { flowId: "run-1", status: "running", stage: "implement", blocker: "等待输入" },
  { flowId: "ask-1", status: "stopped", stage: "implement", blocker: "raise-blocker: 缺 DATABASE_URL，请给测试库连接串" },
  { flowId: "budget-1", status: "stopped", stage: "implement", blocker: "budget-exceeded: usd 120%" },
  { flowId: "stop-1", status: "stopped", stage: "spec", blocker: "误触发：已人工终止清理，无产出" },
];

function state(overrides: Partial<DashboardState>): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
    systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}

describe("求助卡点进收件箱（作者锁定）", () => {
  it("flowBlockers 收 stopped+求助 的流；超预算/误触发的 stopped 仍剔除", () => {
    const ids = flowBlockers(flows as never).map((b) => b.flowId);
    expect(ids).toEqual(["run-1", "ask-1"]);
    expect(flowBlockers(flows as never).find((b) => b.flowId === "ask-1")!.reason).toBe("raise-blocker: 缺 DATABASE_URL，请给测试库连接串");
  });

  it("收件箱里求助条目有回复框与「回复并续跑」按钮，标题不带前缀；普通卡点不变", () => {
    const html = renderReviewInbox(state({
      reviewQueue: [
        { projectId: "proj-a", projectName: "项目A", kind: "blocked", id: "ask-1", title: "raise-blocker: 缺 DATABASE_URL，请给测试库连接串", detail: "阶段 implement" },
        { projectId: "proj-a", projectName: "项目A", kind: "blocked", id: "run-1", title: "等待输入", detail: "阶段 implement" },
      ],
    }));
    expect(html).toContain('data-kp-reply-input="ask-1"');
    expect(html).toContain('data-action="reply-blocker" data-flow="ask-1" data-project="proj-a"');
    expect(html).toContain("回复并续跑");
    expect(html).toContain("等待回复");
    expect(html).toContain("缺 DATABASE_URL，请给测试库连接串");
    expect(html).not.toContain("raise-blocker: 缺");
    expect(html).not.toContain('data-kp-reply-input="run-1"');
    expect(html).toContain('data-kp-dismiss="blocked:ask-1"');
    expect(html).toContain('data-kp-dismiss="blocked:run-1"');
  });
});