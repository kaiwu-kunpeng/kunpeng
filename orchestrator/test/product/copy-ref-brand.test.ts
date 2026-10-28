import { describe, it, expect } from "vitest";
import { extractBrandStyles } from "../../src/product/copy-ref.js";

describe("参考站品牌样式抽取", () => {
  it("从 style 块与 style 属性抽十六进制色，按频次降序去重小写", () => {
    const html = `
      <style>.a{color:#155E75}.b{background:#155e75}.c{border-color:#F0A836}</style>
      <div style="color: #101825"></div>`;
    const out = extractBrandStyles(html);
    expect(out.colors[0]).toBe("#155e75");
    expect(out.colors).toContain("#f0a836");
    expect(out.colors).toContain("#101825");
    expect(new Set(out.colors).size).toBe(out.colors.length);
  });

  it("抽 font-family 首字体名，去引号去重，最多 4 个", () => {
    const html = `<style>
      body{font-family:"Inter Tight", sans-serif}
      h1{font-family: 'Songti SC', serif}
      p{font-family:"Inter Tight", sans-serif}
      .x{font-family: A1,x}.y{font-family: A2,x}.z{font-family: A3,x}
    </style>`;
    const out = extractBrandStyles(html);
    expect(out.fonts).toContain("Inter Tight");
    expect(out.fonts).toContain("Songti SC");
    expect(out.fonts.length).toBeLessThanOrEqual(4);
  });

  it("空输入/无命中返回空数组不抛错", () => {
    expect(extractBrandStyles("")).toEqual({ colors: [], fonts: [] });
    expect(extractBrandStyles("<p>plain</p>").colors).toEqual([]);
  });

  it("colors 最多 8 个", () => {
    const many = Array.from({ length: 12 }, (_, i) => `.c${i}{color:#00000${i.toString(16)}}`).join("");
    const out = extractBrandStyles(`<style>${many}</style>`);
    expect(out.colors.length).toBeLessThanOrEqual(8);
  });
});