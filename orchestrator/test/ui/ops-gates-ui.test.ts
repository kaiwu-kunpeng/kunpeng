import { describe, it, expect } from "vitest";
import { renderActionInbox, type ActionInboxInput } from "../../src/server/ui/views/action-inbox.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import { clientScript } from "../../src/server/ui/client.js";
import type { DashboardState } from "../../src/server/state.js";

function inboxInput(over: Record<string, unknown>): ActionInboxInput {
  return { ...over } as unknown as ActionInboxInput;
}

describe("运营人工门卡片", () => {
  it("pending 门 → 卡片带批准/驳回按钮与 data 属性", () => {
    const html = renderActionInbox(inboxInput({
      opsGates: [{ id: "opsgate-x1", projectId: "acme-shop", playbookId: "acme-catalog", loopId: "acme-catalog", reason: "review 门", status: "pending", createdAt: 1 }],
    }));
    expect(html).toContain('data-action="ops-gate-approve"');
    expect(html).toContain('data-action="ops-gate-reject"');
    expect(html).toContain('data-id="opsgate-x1"');
    expect(html).toContain('data-project="acme-shop"');
    expect(html).toContain("acme-catalog");
  });

  it("无运营门 → 不出现运营门按钮", () => {
    const html = renderActionInbox(inboxInput({}));
    expect(html.includes("ops-gate-approve")).toBe(false);
  });
});

describe("运营 loop 两轮 diff 三态", () => {
  function stateWithWaves(waves: unknown[]): DashboardState {
    const s = {} as unknown as Record<string, unknown>;
    s.loops = [{ id: "l1", name: "L1", projectId: "p", recipe: "r", metric: { key: "k", label: "指标", current: 1 }, levers: [], waves, createdAt: "x", updatedAt: "x" }];
    return s as unknown as DashboardState;
  }

  it("两轮 waves → 渲染 ops-diff 芯片行(新增/已解决/仍在)", () => {
    const html = renderLoops(stateWithWaves([
      { seq: 1, at: "t1", lever: "a", subject: "s", metricDelta: 0, metricAfter: 1, verified: true, gotchas: ["甲", "乙"] },
      { seq: 2, at: "t2", lever: "a", subject: "s", metricDelta: 0, metricAfter: 1, verified: true, gotchas: ["乙", "丙"] },
    ]));
    expect(html).toContain("ops-diff");
    expect(html).toContain("新增 1");
    expect(html).toContain("已解决 1");
    expect(html).toContain("仍在 1");
  });

  it("单轮 wave → 不渲染 ops-diff", () => {
    const html = renderLoops(stateWithWaves([
      { seq: 1, at: "t1", lever: "a", subject: "s", metricDelta: 0, metricAfter: 1, verified: true, gotchas: ["甲"] },
    ]));
    expect(html.includes("ops-diff")).toBe(false);
  });
});

describe("运营门裁决点击分发(client 源码 接线)", () => {
  const src = clientScript;

  it("两个分支 action 名都在场", () => {
    expect(src).toContain('action === "ops-gate-approve"');
    expect(src).toContain('action === "ops-gate-reject"');
  });

  it("命中裁决端点", () => {
    expect(src).toContain("/api/ops-gate-decide");
  });

  it("两个 decision 字面量都发出", () => {
    expect(src).toContain('"approve"');
    expect(src).toContain('"reject"');
  });

  it("approve 分支带二次确认文案（reject 无 confirm 由要求约束+人工复核）", () => {
    expect(src).toContain("批准并立刻起跑该 playbook 对应 loop");
  });

  it("裁决请求读取门 id 与项目", () => {
    expect(src).toContain('attr(el, "data-id")');
    expect(src).toContain("data-project");
  });
});