import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { renderProductHub } from "../../src/server/ui/views/project.js";

describe("彻底删除按钮", () => {
  it("archived 产品行有「彻底删除」按钮 + data-slug", () => {
    const html = renderProductHub({ productList: [], productArchived: [
      { slug: "z", title: "旧产品", status: "archived", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).toContain('data-action="product-purge"');
    expect(html).toContain("彻底删除");
    expect(html).toContain('data-slug="z"');
  });
  it("active 产品行不出现彻底删除（只软删）", () => {
    const html = renderProductHub({ productList: [
      { slug: "a", title: "A", status: "active", createdAt: 1, updatedAt: 1 },
    ] });
    expect(html).not.toContain('data-action="product-purge"');
  });
  it("client 源码 有 product-purge 处理器并调 purge 端点", () => {
    const src = clientSource();
    expect(src).toContain('action === "product-purge"');
    expect(src).toContain("/api/product/purge");
  });
});