import { describe, it, expect } from "vitest";
import { renderEmptyState } from "../../src/server/ui/empty-state.js";

describe("renderEmptyState", () => {
  it("标题+提示+action 按钮齐全", () => {
    const html = renderEmptyState({
      title: "还没有产品",
      hint: "一句话就能开始第一个",
      actions: [{ label: "新建产品", action: "product-new" }],
    });
    expect(html).toContain("还没有产品");
    expect(html).toContain("一句话就能开始第一个");
    expect(html).toContain('data-action="product-new"');
    expect(html).toContain('class="run empty"');
  });
  it("href 型 action 渲染为链接", () => {
    const html = renderEmptyState({ title: "空", actions: [{ label: "去看看", href: "#/knowledge" }] });
    expect(html).toContain('href="#/knowledge"');
    expect(html).not.toContain("data-action=");
  });
  it("内容被 escape", () => {
    const html = renderEmptyState({ title: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("无 hint 无 actions 也能渲染", () => {
    const html = renderEmptyState({ title: "空空如也" });
    expect(html).toContain("空空如也");
  });
});