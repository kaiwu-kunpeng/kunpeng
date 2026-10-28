import { describe, it, expect } from "vitest";
import { renderFilledAdr } from "../src/dossier/adr.js";
import { validationAdrSections } from "../src/product/loop-close.js";
import { closeValidationLoop } from "../src/product/loop-close.js";

const pitch = {
  title: "办事台 MVP", appetite: "6 周", problem: "外国人办事流程复杂", solution: "一站式",
  buildScope: ["签证查询"], rabbitHoles: [], noGos: [], successMetrics: ["周活 1k"],
};
const mkV = (decision: "pivot" | "persevere" | "inconclusive") => ({
  hypotheses: ["用户愿意为省时间付费"],
  signals: [{ source: "访谈", kind: "interview" as const, summary: "正面", synthetic: true }],
  decision, rationale: "理由X", requiresHumanGate: true,
});

describe("validationAdrSections", () => {
  it("inconclusive → null(不建 ADR)", () => {
    const v = mkV("inconclusive");
    expect(validationAdrSections(v, closeValidationLoop(v, pitch), pitch)).toBeNull();
  });
  it("persevere → 非空,含裁定/下一步/构建后果", () => {
    const v = mkV("persevere");
    const s = validationAdrSections(v, closeValidationLoop(v, pitch), pitch)!;
    expect(s.title).toContain("persevere");
    expect(s.title).toContain("办事台 MVP");
    expect(s.decision).toContain("理由X");
    expect(s.context).toContain("含合成信号");
    expect(s.consequences).toContain("构建");
  });
  it("pivot → 非空,后果含转向", () => {
    const v = mkV("pivot");
    const s = validationAdrSections(v, closeValidationLoop(v, pitch), pitch)!;
    expect(s.title).toContain("pivot");
    expect(s.consequences).toContain("转向");
  });
});

describe("renderFilledAdr", () => {
  it("渲染填充内容(非占位)", () => {
    const md = renderFilledAdr("0007", "某决策", { status: "Accepted", dateISO: "2026-06-20" },
      { context: "背景C", decision: "决定D", consequences: "后果E" });
    expect(md).toContain("# ADR-0007: 某决策");
    expect(md).toContain("**Status**: Accepted");
    expect(md).toContain("背景C");
    expect(md).toContain("决定D");
    expect(md).toContain("后果E");
    expect(md).not.toContain("_(决策背后的受力"); // 不是占位模板
  });
});
