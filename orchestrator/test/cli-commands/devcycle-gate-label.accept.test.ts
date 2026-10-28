import { describe, it, expect } from "vitest";
import { isPlanMergeGateLabel, resolveRequirementInput } from "../../src/cli-commands/devcycle.js";

describe("方案集成合并门标签识别（防止空壳流）", () => {
  it("完整流 id 的合并门标签 → true", () => {
    expect(isPlanMergeGateLabel("方案集成 plan-msvw2sc7-9c7c4a")).toBe(true);
  });

  it("无 run 后缀的 planId 合并门标签 → true", () => {
    expect(isPlanMergeGateLabel("方案集成 plan-msvvuzja")).toBe(true);
  });

  it("前后空白与中间多空白容错 → true", () => {
    expect(isPlanMergeGateLabel("  方案集成   plan-abc123  ")).toBe(true);
  });

  it("以「方案集成 plan-」开头但带尾随正文 → false", () => {
    expect(isPlanMergeGateLabel("方案集成 plan-msvw2sc7 合并到主干并刷新文档")).toBe(false);
  });

  it("把「方案集成」当普通词的真实需求 → false", () => {
    expect(isPlanMergeGateLabel("给方案集成到知识库的功能加一个入口")).toBe(false);
  });

  it("不以「方案集成」开头的真实需求 → false", () => {
    expect(isPlanMergeGateLabel("实现 plan 的合并确认弹窗")).toBe(false);
  });

  it("缺少「方案集成」前缀的裸 id → false", () => {
    expect(isPlanMergeGateLabel("plan-msvw2sc7-9c7c4a")).toBe(false);
  });

  it("空串 → false", () => {
    expect(isPlanMergeGateLabel("")).toBe(false);
  });

  it("仅空白 → false", () => {
    expect(isPlanMergeGateLabel("   ")).toBe(false);
  });

  it("回归：resolveRequirementInput 原样返回普通一句话需求", () => {
    const out = resolveRequirementInput("加个按钮", { exists: () => false, read: () => "" });
    expect(out.requirement).toBe("加个按钮");
    expect(out.sourcePath).toBeUndefined();
  });
});