import { describe, it, expect } from "vitest";
import { renderProductActivity } from "../../src/server/ui/views/project.js";

describe("renderProductActivity", () => {
  it("渲染活动条目(actor/summary/kind/stage)与计数", () => {
    const html = renderProductActivity({ productActivity: [
      { ts: 2, actor: "admin", kind: "accept", summary: "接受 spec", stage: "spec" },
      { ts: 1, actor: "claude", kind: "create", summary: "新建产品「X」" },
    ] });
    expect(html).toContain("admin");
    expect(html).toContain("接受 spec");
    expect(html).toContain("spec");
    expect(html).toContain("新建产品");
    expect(html).toContain("2 条");
  });
  it("空 → 空串", () => {
    expect(renderProductActivity({ productActivity: [] })).toBe("");
    expect(renderProductActivity({})).toBe("");
  });
  it("转义 summary 防注入", () => {
    const html = renderProductActivity({ productActivity: [
      { ts: 1, actor: "a", kind: "k", summary: "<script>" },
    ] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});