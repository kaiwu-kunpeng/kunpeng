import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";
import type { DashboardState } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "proj-a", name: "项目A", repoPath: "/tmp/proj-a", state } as unknown as ProjectSnapshot;
}

describe("求助流在收件箱只出现一次（作者锁定）", () => {
  it("stopped+求助 → 只进 blocked，不进 failed；超预算/普通 stopped 仍进 failed", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [],
      artifacts: {},
      flows: [
        { flowId: "ask-1", requirement: "接支付", status: "stopped", blocker: "raise-blocker: 需要人决定用哪个支付渠道", updatedAt: 5 },
        { flowId: "budget-1", requirement: "跑批", status: "stopped", blocker: "budget-exceeded: usd 120%", updatedAt: 4 },
        { flowId: "stop-1", requirement: "被停任务", status: "stopped", updatedAt: 3 },
        { flowId: "crash-1", requirement: "崩了", status: "crashed", blocker: "OOM", updatedAt: 2 },
      ],
      blockers: [{ flowId: "ask-1", stage: "implement", reason: "raise-blocker: 需要人决定用哪个支付渠道" }],
    })]);
    const failedIds = q.filter((i) => i.kind === "failed").map((i) => i.id);
    expect(failedIds).not.toContain("ask-1");
    expect(failedIds).toEqual(expect.arrayContaining(["budget-1", "stop-1", "crash-1"]));
    expect(q.filter((i) => i.kind === "blocked").map((i) => i.id)).toEqual(["ask-1"]);
    expect(q.filter((i) => i.id === "ask-1")).toHaveLength(1);
  });

  it("回复框有 token 样式", () => {
    const html = renderReviewInbox({
      agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
      systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
      code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
      designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
      reviewQueue: [{ projectId: "proj-a", projectName: "项目A", kind: "blocked", id: "ask-1", title: "raise-blocker: 需要人决定", detail: "阶段 implement" }],
    } as DashboardState);
    expect(html).toContain(".kp-reply{");
    expect(html).toContain("resize:vertical");
    expect(html).toContain(".kp-reply::placeholder{color:var(--muted)}");
    expect(html).toContain('data-kp-reply-input="ask-1"');
    expect(html).not.toContain('style="');
  });
});