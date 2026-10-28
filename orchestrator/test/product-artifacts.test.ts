import { describe, it, expect } from "vitest";
import { productSlug, renderDefineMd, renderDiscoverMd, renderPitchMd } from "../src/product/artifacts.js";

describe("productSlug", () => {
  it("kebab + 截断", () => { expect(productSlug("My New Product!")).toBe("my-new-product"); });
  it("空 → product", () => { expect(productSlug("   ")).toBe("product"); });
});

describe("renderDefineMd", () => {
  it("含问题/用户/验收/非目标", () => {
    const md = renderDefineMd({
      idea: "外国人来华办事台", problem: "流程复杂", jobStatement: "帮我快速办妥",
      users: ["外籍人士"], stories: ["查签证"], acceptance: ["3 步内完成"], nonGoals: ["不做支付"],
    });
    expect(md).toContain("PR-FAQ");
    expect(md).toContain("外国人来华办事台");
    expect(md).toContain("流程复杂");
    expect(md).toContain("Job Statement");
    expect(md).toContain("- 外籍人士");
    expect(md).toContain("- 3 步内完成");
    expect(md).toContain("- 不做支付");
  });
  it("无 nonGoals 不崩、显示无", () => {
    const md = renderDefineMd({ idea: "x", problem: "y", users: [], stories: [], acceptance: [] });
    expect(md).toContain("## 非目标");
    expect(md).toContain("_(无)_");
  });
});

describe("renderDiscoverMd", () => {
  it("含机会表 + 合成证据警示", () => {
    const md = renderDiscoverMd({
      definition: { idea: "x", problem: "y", users: [], stories: [], acceptance: [] },
      jobStatement: "JTBD", targetUsers: ["U"], alternatives: ["竞品A"],
      opportunities: [{ outcome: "更快办妥", importance: 8, satisfaction: 3, opportunityScore: 13 }],
      syntheticEvidence: true,
    });
    expect(md).toContain("机会发现（OST）");
    expect(md).toContain("合成证据");
    expect(md).toContain("更快办妥");
    expect(md).toContain("13");
    expect(md).toContain("- 竞品A");
  });
});

describe("renderPitchMd", () => {
  it("含 Shape Up 五要素", () => {
    const md = renderPitchMd({
      title: "办事台 MVP", appetite: "6 周", problem: "P", solution: "S",
      buildScope: ["签证查询"], rabbitHoles: ["支付集成"], noGos: ["原生 App"], successMetrics: ["周活 1k"],
    });
    expect(md).toContain("办事台 MVP");
    expect(md).toContain("6 周");
    expect(md).toContain("## Problem");
    expect(md).toContain("## Solution");
    expect(md).toContain("- 签证查询");
    expect(md).toContain("- 支付集成");
    expect(md).toContain("- 原生 App");
    expect(md).toContain("- 周活 1k");
  });
});
