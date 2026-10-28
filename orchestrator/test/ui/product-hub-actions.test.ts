import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { renderProductHub } from "../../src/server/ui/views/project.js";

describe("product hub 新建/删除交互", () => {
  it("非空 hub 渲染新建输入 + 按钮", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain("data-product-new-input");
    expect(html).toContain('data-action="product-new"');
  });
  it("每个产品带删除按钮 + data-slug", () => {
    const html = renderProductHub({ productList: [
      { slug: "my-slug", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain('data-action="product-delete"');
    expect(html).toContain('data-slug="my-slug"');
  });
  it("空列表也渲染新建/复制入口（修复 hub 消失 bug，不再返回空串）", () => {
    const html = renderProductHub({ productList: [] });
    expect(html).not.toBe("");
    expect(html).toContain("data-product-new-input");
    expect(html).toContain('data-action="product-copy-ref"');
  });
  it("client 源码 含 product-new/product-delete 处理并调端点", () => {
    const src = clientSource();
    expect(src).toContain('action === "product-new"');
    expect(src).toContain('action === "product-delete"');
    expect(src).toContain("/api/product/new");
    expect(src).toContain("/api/product/delete");
  });
});