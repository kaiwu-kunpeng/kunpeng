import { describe, it, expect } from "vitest";
import { httpSource } from "../helpers/http-source.js";

// 结构性断言：http.ts 已接线三个产品列表端点并调 registry-service。
describe("product list/new/delete 端点已接线", () => {
  const src = httpSource();
  it("含三个路由路径", () => {
    expect(src).toContain("/api/product/list");
    expect(src).toContain("/api/product/new");
    expect(src).toContain("/api/product/delete");
  });
  it("调用 registry-service 三个函数", () => {
    expect(src).toMatch(/listProductsView\(/);
    expect(src).toMatch(/createProduct\(/);
    expect(src).toMatch(/deleteProduct\(/);
  });
  it("从 registry-service.js 导入", () => {
    expect(src).toMatch(/from "\.\.\/product\/registry-service\.js"/);
  });
});
