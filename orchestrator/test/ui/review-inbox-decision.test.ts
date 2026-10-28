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

describe("收件箱渲染决策块与运营门条目（作者锁定）", () => {
  it("爆炸半径标签、证据行、成本行；ops-gate 条目复用运营门按钮且不与 state.opsGates 双列", () => {
    const html = renderReviewInbox(state({
      opsGates: [{ id: "og-1", projectId: "proj-a", playbookId: "pz-internal-links", loopId: "pz-links", reason: "review 门", status: "pending", createdAt: 1 }],
      reviewQueue: [
        { projectId: "proj-a", projectName: "项目A", kind: "merge", id: "f-1", title: "合并主干 kp/f-1 → main", detail: "d",
          decision: { action: "merge-main", blastRadius: "L3", evidence: "触及敏感路径；改动 7 个文件", costUsd: 3.25 } },
        { projectId: "proj-a", projectName: "项目A", kind: "release", id: "rel-1", title: "rel-1", detail: "build",
          decision: { action: "confirm-release", blastRadius: "L4", evidence: "build" } },
        { projectId: "proj-a", projectName: "项目A", kind: "ops-gate", id: "og-1", title: "pz-internal-links", detail: "review 门",
          decision: { action: "ops-gate-approve", blastRadius: "L2", evidence: "loop pz-links" } },
        { projectId: "proj-a", projectName: "项目A", kind: "failed", id: "dead-1", title: "崩了", detail: "crashed · OOM" },
      ],
    }));
    expect(html).toContain('data-kp-blast="L3"');
    expect(html).toContain('data-kp-blast="L4"');
    expect(html).toContain("证据：触及敏感路径；改动 7 个文件");
    expect(html).toContain("已花 $3.25");
    expect(html).toContain('data-action="ops-gate-approve" data-id="og-1" data-project="proj-a"');
    expect(html).toContain('data-action="ops-gate-reject" data-id="og-1" data-project="proj-a"');
    expect((html.match(/data-kp-inbox-id="ops:og-1"/g) ?? []).length).toBe(1);
    expect(html).toContain("运营触发放行");
    const failedCard = html.slice(html.indexOf('data-kp-inbox-id="failed:dead-1"'));
    expect(failedCard.slice(0, 1500)).not.toContain("data-kp-blast=");
  });
});