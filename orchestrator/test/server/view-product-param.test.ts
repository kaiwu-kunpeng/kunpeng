import { describe, it, expect } from "vitest";
import { httpSource } from "../helpers/http-source.js";

// 结构性断言：/api/view 解析 ?product= 并经 collectProjectDashboardState 用 readProductSessionViewForSlug 覆盖。
describe("/api/view 选品参数已接线", () => {
  const src = httpSource();
  it("/api/view 解析 product 查询参数", () => {
    expect(src).toMatch(/searchParams\.get\("product"\)/);
  });
  it("collectProjectDashboardState 带 selectedProductSlug 参数", () => {
    expect(src).toMatch(/selectedProductSlug/);
  });
  it("调用 readProductSessionViewForSlug", () => {
    expect(src).toMatch(/readProductSessionViewForSlug\(/);
  });
  it("从 state.js 导入该函数", () => {
    expect(src).toMatch(/readProductSessionViewForSlug[\s\S]*from "\.\/state\.js"/);
  });
});
