import { describe, it, expect } from "vitest";
import { heuristicSummarize } from "../src/knowledge/capture-cli.js";

describe("heuristicSummarize · HTML 质量", () => {
  it("HTML 输入 → 摘要是正文文本而非 '<',tags 不含标签名", () => {
    const html = "<!doctype html><html><head><style>.a{color:red}</style></head>" +
      "<body><div class='x'><span>外国人来华办事台是一个帮助外籍人士办事的平台。</span></div></body></html>";
    const r = heuristicSummarize(html);
    expect(r.summary.startsWith("<")).toBe(false);
    expect(r.summary).toContain("外国人来华办事台");
    expect(r.tags).not.toContain("div");
    expect(r.tags).not.toContain("span");
    expect(r.tags).not.toContain("style");
  });
  it("纯文本输入 → 行为不变(取首句)", () => {
    const r = heuristicSummarize("第一句话。第二句话。");
    expect(r.summary).toBe("第一句话");
  });
  it("空 → 空摘要", () => {
    expect(heuristicSummarize("   ").summary).toBe("");
  });
  it("退化输入(只有标签) → 不返回 '<'", () => {
    const r = heuristicSummarize("<br><hr>");
    expect(r.summary.startsWith("<")).toBe(false);
  });
});
