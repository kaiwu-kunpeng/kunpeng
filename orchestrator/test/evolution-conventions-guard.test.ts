import { describe, it, expect } from "vitest";
import { conventionsChangeProblems } from "../src/evolution/conventions-guard.js";

describe("conventions 落地质量门（挡占位/垃圾进宪法）", () => {
  it("放行具体可执行的真约定", () => {
    expect(conventionsChangeProblems("PR 必须带验证证据 (C3)")).toEqual([]);
    expect(conventionsChangeProblems("spec 的 accept 必须硬断言新产物存在")).toEqual([]);
  });

  it("拒占位模板「建议补一条约定」", () => {
    const p = conventionsChangeProblems("复发卡点「审计未通过」出现 89 次（流 f1/f2）→ 建议补一条约定预防此类失败");
    expect(p.length).toBeGreaterThan(0);
    expect(p.join()).toContain("占位");
  });

  it("拒空文本与空卡点", () => {
    expect(conventionsChangeProblems("   ").length).toBeGreaterThan(0);
    expect(conventionsChangeProblems("复发卡点「」出现 2 次").length).toBeGreaterThan(0);
  });

  it("拒含本机绝对路径", () => {
    expect(conventionsChangeProblems("worktree 基底见 /Users/dev/kunpeng/orchestrator").length).toBeGreaterThan(0);
    expect(conventionsChangeProblems("临时产物放 /private/tmp/xx").length).toBeGreaterThan(0);
  });

  it("拒超长流水账(>400字符)", () => {
    expect(conventionsChangeProblems(`卡点 ${"流id/".repeat(120)} 需要预防`).length).toBeGreaterThan(0);
  });
});