import { describe, it, expect } from "vitest";
import { stateSource } from "../helpers/state-source.js";

// 结构性断言：state 聚合模块已把 productList 接进 DashboardState 与 collectState。
describe("DashboardState.productList 已接线", () => {
  const src = stateSource();
  it("接口声明 productList 字段", () => {
    expect(src).toMatch(/productList\?:\s*ProductEntry\[\]/);
  });
  it("collectState 调 listProductsView 收集", () => {
    expect(src).toMatch(/listProductsView\(/);
  });
  it("从 registry-service.js 导入 listProductsView", () => {
    expect(src).toMatch(/listProductsView.*from "\.\.\/\.\.\/product\/registry-service\.js"/s);
  });
  it("ProductEntry 类型已导入", () => {
    expect(src).toMatch(/ProductEntry.*from "\.\.\/\.\.\/product\/registry\.js"/s);
  });
});
