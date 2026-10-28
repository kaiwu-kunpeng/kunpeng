import { readFileSync } from "node:fs";
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

describe("收件箱按 owner 筛（作者锁定）", () => {
  it("有 owner 的条目带 data-kp-owner 与 owner 标签；筛选下拉列出去重 owner；无 owner 时不渲染下拉", () => {
    const html = renderReviewInbox(state({
      reviewQueue: [
        { projectId: "p", projectName: "P", kind: "merge", id: "f-1", title: "合并", detail: "d",
          decision: { action: "merge-main", blastRadius: "L2", owner: "alice" } },
        { projectId: "p", projectName: "P", kind: "merge", id: "f-2", title: "合并", detail: "d",
          decision: { action: "merge-main", blastRadius: "L2", owner: "bob" } },
        { projectId: "p", projectName: "P", kind: "merge", id: "f-3", title: "合并", detail: "d",
          decision: { action: "merge-main", blastRadius: "L2", owner: "alice" } },
        { projectId: "p", projectName: "P", kind: "failed", id: "dead-1", title: "崩", detail: "x" },
      ],
    }));
    const f1 = html.slice(html.indexOf('data-kp-inbox-id="merge:f-1"') - 400, html.indexOf('data-kp-inbox-id="merge:f-1"') + 1500);
    expect(f1).toContain('data-kp-owner="alice"');
    expect(f1).toContain("<span class=\"tag\" data-kp-owner-tag>owner · alice</span>");
    const dead = html.slice(html.indexOf('data-kp-inbox-id="failed:dead-1"') - 400, html.indexOf('data-kp-inbox-id="failed:dead-1"') + 1500);
    expect(dead).not.toContain("data-kp-owner=");
    expect(html).toContain("<select data-kp-owner-filter>");
    expect(html).toContain('<option value="">全部</option><option value="alice">alice</option><option value="bob">bob</option>');
    expect((html.match(/<option value="alice">/g) ?? []).length).toBe(1);

    const none = renderReviewInbox(state({
      reviewQueue: [{ projectId: "p", projectName: "P", kind: "merge", id: "f-9", title: "合并", detail: "d", decision: { action: "merge-main", blastRadius: "L2" } }],
    }));
    expect(none).not.toContain("data-kp-owner-filter");
  });

  it("客户端脚本片段接了筛选：读写 localStorage 键 kp-inbox-owner、按 data-kp-owner 隐藏条目", () => {
    const part = readFileSync(new URL("../../src/server/ui/client-parts/part02.ts", import.meta.url), "utf8");
    expect(part).toContain("kpInboxApplyOwnerFilter");
    expect(part).toContain('"kp-inbox-owner"');
    expect(part).toContain("[data-kp-owner-filter]");
    expect(part).toContain('getAttribute("data-kp-owner")');
    expect(part).toContain("kpInboxApplyOwnerFilter()");
  });
});