import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";
import { clientScript } from "../../src/server/ui/client.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0,
    flows: [],
    running: [],
    blockers: [],
    humanGates: [{ what: "合并主干 kp/x → main", detail: "d", flowId: "flow-1" }],
    artifacts: {},
    branches: [],
    statusCounts: {},
    systemLight: "green",
    agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  };
}

describe("门诊断 UI", () => {
  test("humanGates 合并卡片带诊断徽章插槽(keyed by flowId)", () => {
    const html = renderReviewInbox(fixture());
    expect(html).toContain('data-gate-diag="flow-1"');
  });

  test("reviewQueue 仅 merge 卡片有诊断插槽,proposal 没有", () => {
    const html = renderReviewInbox(
      fixture({
        reviewQueue: [
          { id: "m1", kind: "merge", projectId: "p", projectName: "P", title: "合并", detail: "d" },
          { id: "pr1", kind: "proposal", projectId: "p", projectName: "P", title: "提案", detail: "d" },
        ],
      }),
    );
    expect(html).toContain('data-gate-diag="m1"');
    expect(html).not.toContain('data-gate-diag="pr1"');
  });

  test("client 接线:拉诊断 + 渲染四态徽章 + 幽灵门一键清", () => {
    expect(clientScript).toContain("gatesDiagnosisLoad");
    expect(clientScript).toContain("/api/gates/diagnosis");
    expect(clientScript).toContain("/api/gates/discard");
    expect(clientScript).toContain("gate-discard");
    expect(clientScript).toContain("diag-ghost");
    expect(clientScript).toContain("diag-warn");
  });
});
