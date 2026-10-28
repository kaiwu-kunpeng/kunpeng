import { describe, it, expect } from "vitest";
import { renderStepBar } from "../../src/server/ui/views/project.js";

describe("renderStepBar 视觉升级", () => {
  it("已接受阶段 ✓、当前阶段 ◉、待办 ○", () => {
    const html = renderStepBar({ currentStage: "design", stages: { define: { status: "accepted" }, spec: { status: "accepted" }, design: { status: "drafted" } } });
    expect(html).toContain("✓"); // define/spec accepted
    expect(html).toContain("◉"); // design current
    expect(html).toContain("○"); // build/validate pending
    expect(html).toContain("定义");
    expect(html).toContain("验证");
    expect(html).toContain("cur"); // 当前 class
  });
  it("缺 stages → 全 pending、有标签", () => {
    const html = renderStepBar({ currentStage: "define", stages: {} });
    expect(html).toContain("step-bar");
    expect(html).toContain("定义");
  });
});