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

describe("硬门标记、二次确认属性、稍后键（作者锁定）", () => {
  it("L4/L3 卡片带硬门标记与 data-kp-confirm；L2 不带；决策卡有稍后键，通知卡没有", () => {
    const html = renderReviewInbox(state({
      reviewQueue: [
        { projectId: "proj-a", projectName: "项目A", kind: "release", id: "rel-1", title: "rel-1", detail: "build",
          decision: { action: "confirm-release", blastRadius: "L4", evidence: "build" } },
        { projectId: "proj-a", projectName: "项目A", kind: "merge", id: "f-soft", title: "合并主干 kp/f-soft → main", detail: "d",
          decision: { action: "merge-main", blastRadius: "L2" } },
        { projectId: "proj-a", projectName: "项目A", kind: "ops-gate", id: "og-1", title: "pb", detail: "r",
          decision: { action: "ops-gate-approve", blastRadius: "L2", evidence: "loop l" } },
        { projectId: "proj-a", projectName: "项目A", kind: "failed", id: "dead-1", title: "崩了", detail: "crashed" },
      ],
    }));
    const card = (marker: string) => { const at = html.indexOf(marker); return html.slice(at, html.indexOf("data-kp-inbox-item", at + 10) > 0 ? html.indexOf("data-kp-inbox-item", at + 10) : undefined); };
    const rel = card('data-kp-inbox-id="release:rel-1"');
    expect(rel).toContain('data-kp-hard="1"');
    expect(rel).toContain("硬门·二次确认");
    expect(rel).toMatch(/data-kp-act="approve"[^>]*data-kp-confirm="L4 [^"]*"|data-kp-confirm="L4 [^"]*"[^>]*data-kp-act="approve"/);
    expect(rel).toContain('data-action="inbox-defer" data-kp-defer="release:rel-1"');
    const soft = card('data-kp-inbox-id="merge:f-soft"');
    expect(soft).not.toContain('data-kp-hard="1"');
    expect(soft).not.toContain("data-kp-confirm=");
    expect(soft).toContain('data-kp-defer="merge:f-soft"');
    expect(card('data-kp-inbox-id="ops:og-1"')).toContain('data-kp-defer="ops:og-1"');
    const failed = card('data-kp-inbox-id="failed:dead-1"');
    expect(failed).not.toContain("inbox-defer");
    expect(failed).toContain('data-action="inbox-dismiss"');
    expect(html).toContain("稍后 24h");
  });
});