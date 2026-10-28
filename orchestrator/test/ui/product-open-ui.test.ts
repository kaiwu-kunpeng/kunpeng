import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { renderProductHub } from "../../src/server/ui/views/project.js";

describe("点产品打开工位", () => {
  it("产品标题渲染为可点 product-open + data-slug", () => {
    const html = renderProductHub({ productList: [
      { slug: "my-slug", title: "研发指挥仪表盘", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain('data-action="product-open"');
    expect(html).toContain('data-slug="my-slug"');
    expect(html).toContain("研发指挥仪表盘");
  });
  it("保留新建/删除入口", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain('data-action="product-new"');
    expect(html).toContain('data-action="product-delete"');
  });
  it("client 源码: product-open 处理器 + renderView 带 product 参数", () => {
    const src = clientSource();
    expect(src).toContain('action === "product-open"');
    expect(src).toContain("kpSelectedProduct");
    expect(src).toContain("&product=");
  });
});