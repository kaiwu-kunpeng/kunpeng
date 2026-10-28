import { describe, it, expect } from "vitest";
import { httpSource } from "../helpers/http-source.js";

// 结构性断言：http.ts 接线了 copy-ref 端点并调 fetch+synth。
describe("copy-ref 端点已接线", () => {
  const src = httpSource();
  it("含 /api/product/copy-ref 路由", () => {
    expect(src).toContain("/api/product/copy-ref");
  });
  it("调用 fetchRefScrape 与 synthesizeFromRef", () => {
    expect(src).toMatch(/fetchRefScrape\(/);
    expect(src).toMatch(/synthesizeFromRef\(/);
  });
  it("从 fetch-ref.js / copy-ref-synth.js 导入", () => {
    expect(src).toMatch(/from "\.\.\/product\/fetch-ref\.js"/);
    expect(src).toMatch(/from "\.\.\/product\/copy-ref-synth\.js"/);
  });
});
