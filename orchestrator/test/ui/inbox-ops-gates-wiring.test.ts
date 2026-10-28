import { describe, it, expect } from "vitest";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState } from "../../src/server/state.js";

function stateWith(over: Record<string, unknown>): DashboardState {
  return {
    humanGates: [],
    flows: [],
    artifacts: {},
    ...over,
  } as unknown as DashboardState;
}

const gate = { id: "opsgate-w1", projectId: "acme-shop", playbookId: "acme-catalog", loopId: "l1", reason: "review 门", status: "pending", createdAt: 1 };

describe("运营门接进待我处理页", () => {
  it("有 pending 运营门 → 卡片与按钮在场，空态消失", () => {
    const html = renderReviewInbox(stateWith({ opsGates: [gate] }));
    expect(html).toContain('data-action="ops-gate-approve"');
    expect(html).toContain('data-id="opsgate-w1"');
    expect(html).toContain('data-project="acme-shop"');
    expect(html).toContain("acme-catalog");
    expect(html.includes("暂无待处理的门")).toBe(false);
  });

  it("非 pending 不渲染；无运营门时空态保持", () => {
    const done = { ...gate, status: "approved" };
    const html = renderReviewInbox(stateWith({ opsGates: [done] }));
    expect(html.includes("ops-gate-approve")).toBe(false);
    expect(html).toContain("暂无待处理的门");
  });

  it("overview 装配点已传 opsGates(行为断言:overview 渲染出运营门,非 pending 不渲染)", () => {
    const html = renderOverview(stateWith({ opsGates: [gate] }));
    expect(html).toContain("ops-gate-approve");
    expect(html).toContain("opsgate-w1");
    const done = renderOverview(stateWith({ opsGates: [{ ...gate, status: "approved" }] }));
    expect(done.includes("ops-gate-approve")).toBe(false);
  });
});