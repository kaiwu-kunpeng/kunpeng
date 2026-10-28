import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { renderProductHub } from "../../src/server/ui/views/project.js";

describe("复制参考产品 UI", () => {
  it("hub 渲染参考网址输入 + 复制按钮", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain("data-product-ref-input");
    expect(html).toContain('data-action="product-copy-ref"');
  });
  it("保留新建/删除入口（不破既有）", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain('data-action="product-new"');
    expect(html).toContain('data-action="product-delete"');
  });
  it("client 源码 含 product-copy-ref 处理并调端点", () => {
    const src = clientSource();
    expect(src).toContain('action === "product-copy-ref"');
    expect(src).toContain("/api/product/copy-ref");
  });
});