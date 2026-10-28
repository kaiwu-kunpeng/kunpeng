import { describe, expect, it } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";

function state(overrides: Partial<DashboardState>): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {}, branches: [], statusCounts: {},
    systemLight: "green", agentAssignments: [], patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}
const merge = (id: string, extra: Record<string, unknown> = {}) => ({
  projectId: "proj-a", projectName: "项目A", kind: "merge" as const, id, title: `合并主干 kp/${id} → main`, detail: "d",
  decision: { action: "merge-main", blastRadius: "L3" as const, ...extra },
});

describe("收件箱策略渲染（作者锁定）", () => {
  it("缺席横幅、已过期标签、限流折叠行、缺席中标签；侧栏红点只数可处理的", () => {
    const s = state({
      inboxPolicy: { dailyHardCapPerProject: 5, gateTtlHours: 168, absence: { until: Date.now() + 3_600_000, note: "出差" } },
      reviewQueue: [
        merge("live", { absent: true }),
        merge("old", { expired: true, absent: true }),
        merge("held-1", { heldByCap: true }),
        merge("held-2", { heldByCap: true }),
        { projectId: "proj-a", projectName: "项目A", kind: "failed", id: "dead-1", title: "崩了", detail: "crashed" },
      ],
    });
    const html = renderReviewInbox(s);
    expect(html).toContain("data-kp-absence");
    expect(html).toContain("缺席模式至");
    expect(html).toContain("出差");
    expect(html).toContain('data-kp-inbox-id="merge:live"');
    expect(html).toContain("缺席中");
    expect(html).toContain("已过期");
    expect(html).not.toContain('data-kp-inbox-id="merge:held-1"');
    expect(html).toContain('data-kp-held="2"');
    expect(html).toContain("今日限流");
    expect(html.indexOf('data-kp-inbox-id="merge:live"')).toBeLessThan(html.indexOf('data-kp-inbox-id="merge:old"'));
    const sidebar = renderSidebar(s, "#/inbox");
    expect(sidebar).toContain('<span class="badge">2</span>');
  });

  it("无策略、无标记时渲染与第二片一致（没有横幅与折叠行）", () => {
    const html = renderReviewInbox(state({ reviewQueue: [merge("plain")] }));
    expect(html).not.toContain("data-kp-absence");
    expect(html).not.toContain("今日限流");
    expect(html).not.toContain("已过期");
  });
});