import { describe, it, expect } from "vitest";
import { renderProject, renderProductLanding } from "../../src/server/ui/views/project.js";

const baseState = (over: Record<string, unknown> = {}) => ({ productList: [], plans: [], ...over });
const sessionFor = (slug: string) => ({
  status: "done", idea: slug, answeredCount: 0, totalQuestions: 5,
  definition: { problem: "p", users: [], stories: [], acceptance: [] },
  loop: { slug, currentStage: "design", stages: {}, brief: {} },
});

describe("产品 tab 默认空态（未选中不进工位）", () => {
  it("renderProductLanding：有产品→引导点选；无产品→引导新建", () => {
    expect(renderProductLanding({ productList: [{ slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 }] })).toContain("点上方");
    expect(renderProductLanding({ productList: [] })).toContain("还没有产品");
  });
  it("未选中（productSelected 未设）→ 产品 tab 只显示 hub + 空态，不渲染设计工位", () => {
    const html = renderProject(baseState({
      productList: [{ slug: "x", title: "研发指挥仪表盘", currentStage: "design", status: "active", createdAt: 1, updatedAt: 1 }],
      productSession: sessionFor("x"),
    }) as never, "kunpeng", "product");
    expect(html).toContain("新建产品");        // hub 在
    expect(html).not.toContain("设计 BRIEF");   // 工位不渲染（门控生效）
  });
  it("选中（productSelected=true）→ 渲染设计工位", () => {
    const html = renderProject(baseState({
      productSelected: true,
      productSession: sessionFor("x"),
    }) as never, "kunpeng", "product");
    expect(html).toContain("设计 BRIEF");
  });
});