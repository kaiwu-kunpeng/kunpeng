import { describe, it, expect } from "vitest";
import { escHtml } from "./esc-html.js";

describe("escHtml", () => {
  it("转义全部 5 个 HTML 敏感字符", () => {
    expect(escHtml(`<a href="x" data='y'>&`)).toBe("&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;");
  });
  it("& 先转义,不产生双重转义", () => {
    expect(escHtml("a&b")).toBe("a&amp;b");
    expect(escHtml("<")).toBe("&lt;");
  });
  it("null/undefined 归一为空串", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });
  it("数字等非串入参先 String 化", () => {
    expect(escHtml(42)).toBe("42");
  });
});