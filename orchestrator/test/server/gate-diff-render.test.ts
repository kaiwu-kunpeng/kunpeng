import { describe, expect, it } from "vitest";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

describe("review-inbox 看改动按钮", () => {
  it("合并门渲染含 gate-diff 动作", () => {
    const state: Parameters<typeof renderReviewInbox>[0] = {
      humanGates: [{ flowId: "flowX", what: "合并主干 (人工门#1)", detail: "kp/flowX → main" }],
      agents: 0, flows: [], branches: [], statusCounts: {}, systemLight: "green",
      agentAssignments: [], plans: [], designCandidates: [],
      patrol: { pendingCount: 0, lastRunText: "" },
      code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
      artifacts: {}, running: [], blockers: [], health: { alerts: [], running: 0, healthy: 0 },
    };
    const html = renderReviewInbox(state);
    expect(html).toContain('data-action="gate-diff"');
    expect(html).toContain("flowX");
  });
});
