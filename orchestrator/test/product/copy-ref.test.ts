import { describe, it, expect } from "vitest";
import { parseIaFromLinks, extractPositioning, extractThemeColor } from "../../src/product/copy-ref.js";

describe("parseIaFromLinks", () => {
  it("只留站内页路径、滤掉静态资源/cdn/static/_next、去重排序", () => {
    const links = [
      "https://linear.app/",
      "https://linear.app/pricing",
      "https://linear.app/features",
      "https://linear.app/pricing",                                  // 重复
      "https://static.linear.app/web/_next/static/x.css",            // 跨 host + 静态
      "https://linear.app/static/favicon.svg",                       // /static/
      "https://linear.app/cdn-cgi/image/y",                          // /cdn-cgi/
      "https://linear.app/logo.png",                                 // 静态后缀
      "https://x.com/linear",                                        // 站外 host
      "not a url",                                                   // 解析失败
    ];
    expect(parseIaFromLinks(links, "linear.app")).toEqual(["/", "/features", "/pricing"]);
  });
  it("空输入 → 空数组", () => {
    expect(parseIaFromLinks([], "linear.app")).toEqual([]);
  });
});

describe("extractPositioning", () => {
  it("取 title/description，回退 og:*", () => {
    expect(extractPositioning({ title: "Linear", description: "Build products" }))
      .toEqual({ title: "Linear", description: "Build products" });
    expect(extractPositioning({ "og:title": "L", "og:description": "D" }))
      .toEqual({ title: "L", description: "D" });
  });
  it("缺失 → undefined", () => {
    expect(extractPositioning({})).toEqual({ title: undefined, description: undefined });
  });
});

describe("extractThemeColor", () => {
  it("取 theme-color 字符串", () => {
    expect(extractThemeColor({ "theme-color": "#08090a" })).toBe("#08090a");
  });
  it("非字符串/缺失 → undefined", () => {
    expect(extractThemeColor({})).toBeUndefined();
    expect(extractThemeColor({ "theme-color": 123 })).toBeUndefined();
  });
});