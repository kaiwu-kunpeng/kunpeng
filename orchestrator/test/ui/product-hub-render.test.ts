import { describe, it, expect } from "vitest";
import { renderProductHub } from "../../src/server/ui/views/project.js";

describe("renderProductHub", () => {
  it("列出 active 产品（标题/阶段/删除按钮）+ 计数", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "研发指挥仪表盘", currentStage: "design", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain("研发指挥仪表盘");
    expect(html).toContain("design");
    expect(html).toContain('data-action="product-delete"');
    expect(html).toContain("1 个产品");
  });
  it("空列表仍渲染「新建/复制参考」入口（不再返回空串）", () => {
    const html = renderProductHub({ productList: [] });
    expect(html).not.toBe("");
    expect(html).toContain("data-product-new-input");
    expect(html).toContain('data-action="product-copy-ref"');
    expect(html).toContain('data-action="product-new"');
  });
  it("已删除产品显示「恢复」按钮 + 已删除计数", () => {
    const html = renderProductHub({ productList: [], productArchived: [
      { slug: "z", title: "旧产品", status: "archived", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain("旧产品");
    expect(html).toContain('data-action="product-restore"');
    expect(html).toContain("已删除");
    expect(html).toContain("1 个已删除");
  });
  it("转义产品标题，防裸 HTML 注入", () => {
    const html = renderProductHub({ productList: [
      { slug: "x", title: "<script>", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});