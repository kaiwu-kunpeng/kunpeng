import { describe, it, expect } from "vitest";
import { renderPlans } from "../../src/server/ui/views/project.js";

const onePlan = (over: Record<string, unknown> = {}) => ({
  plans: [{ id: "plan-x", status: "verified", merged: false, desc: "加恢复入口", summary: "实现产品恢复链路", segmentCount: 2, ...over }],
});

describe("renderPlans 卡片化", () => {
  it("渲染 plan-card 网格 + 标题/摘要/段数/查看", () => {
    const html = renderPlans(onePlan() as never);
    expect(html).toContain("plan-cards");
    expect(html).toContain("plan-card");
    expect(html).toContain("加恢复入口");
    expect(html).toContain("实现产品恢复链路");
    expect(html).toContain('data-action="view-plan"');
    expect(html).toContain("2 段");
  });
  it("已合并 → merged 徽章文案「已合并」", () => {
    const html = renderPlans(onePlan({ merged: true }) as never);
    expect(html).toContain("已合并");
    expect(html).toContain("merged");
  });
  it("空 plans → 暂无方案", () => {
    expect(renderPlans({ plans: [] } as never)).toContain("暂无方案");
  });
  it("转义 desc 防注入", () => {
    const html = renderPlans(onePlan({ desc: "<script>" }) as never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});