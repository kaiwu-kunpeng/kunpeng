import { describe, it, expect } from "vitest";
import { stripMd } from "../../src/server/ui/fmt.js";

describe("stripMd 未闭合 markdown（截断源数据）", () => {
  it("未闭合图片留 alt", () => {
    const out = stripMd("![今日头条](https://lf-dw.toutiaostatic.com/obj/toutiao-duanwai/resources/app_nam");
    expect(out).toBe("今日头条");
  });
  it("闭合+未闭合混排", () => {
    const out = stripMd("![今日头条](https://x/1.png)![今日头条](https://lf-dw.toutiaostatic.com/obj/app_nam");
    expect(out).not.toContain("![");
    expect(out).not.toContain("https");
    expect(out).toContain("今日头条");
  });
  it("未闭合链接留文本", () => {
    expect(stripMd("[打开原文](https://mp.toutiao.com/abc")).toBe("打开原文");
  });
  it("正常文本不受影响", () => {
    expect(stripMd("普通标题 (带括号) 无碍")).toBe("普通标题 (带括号) 无碍");
  });
});