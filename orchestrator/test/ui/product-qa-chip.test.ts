import { describe, it, expect } from "vitest";
import { renderQaEvidence } from "../../src/server/ui/views/project.js";

describe("QA 错误证据芯片", () => {
  it("失败 → 错误原文前3条 + 修复任务提示链接", () => {
    const html = renderQaEvidence({
      ok: false,
      problems: ["控制台: TypeError: x is undefined", "网络: GET /api/a → 500", "页面空白: body 文本长度 3", "控制台: 又一条"],
    });
    expect(html).toContain("qa-evidence");
    expect(html).toContain("TypeError: x is undefined");
    expect(html).toContain("GET /api/a → 500");
    expect(html).toContain("等 1 条");
    expect(html).toContain('href="#/tasks"');
    expect(html).toContain("修复任务");
  });

  it("通过 → 保持通过 tag，无错误块", () => {
    const html = renderQaEvidence({ ok: true, problems: [] });
    expect(html).toContain("QA");
    expect(html.includes("qa-problem")).toBe(false);
    expect(html.includes("#/tasks")).toBe(false);
  });

  it("无 qa → 空串；超长错误截断且转义", () => {
    expect(renderQaEvidence(undefined)).toBe("");
    const long = "x".repeat(300) + "<script>";
    const html = renderQaEvidence({ ok: false, problems: [long] });
    expect(html.includes("<script>")).toBe(false);
    expect(html.length).toBeLessThan(1500);
  });
});