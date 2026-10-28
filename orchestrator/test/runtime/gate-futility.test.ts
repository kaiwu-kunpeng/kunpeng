import { describe, it, expect } from "vitest";
import { classifyGateFutility, type GateFutilityGit } from "../../src/runtime/gate-futility.js";

function git(over: Partial<GateFutilityGit>): GateFutilityGit {
  return {
    branchExists: async () => true,
    mergeDiffEmpty: async () => false,
    ...over,
  };
}

describe("classifyGateFutility", () => {
  it("分支不存在 → futile", async () => {
    const v = await classifyGateFutility(git({ branchExists: async () => false }), "x", "main");
    expect(v.futile).toBe(true);
    expect(v.reason).toContain("kp/x");
  });
  it("空 diff → futile", async () => {
    const v = await classifyGateFutility(git({ mergeDiffEmpty: async () => true }), "y", "main");
    expect(v.futile).toBe(true);
    expect(v.reason).toContain("空提交");
  });
  it("分支在且 diff 非空 → 不 futile", async () => {
    const v = await classifyGateFutility(git({}), "z", "main");
    expect(v.futile).toBe(false);
  });
  it("先判分支不存在，不再看 diff", async () => {
    let diffChecked = false;
    const v = await classifyGateFutility(
      git({ branchExists: async () => false, mergeDiffEmpty: async () => { diffChecked = true; return false; } }),
      "w",
      "main",
    );
    expect(v.futile).toBe(true);
    expect(diffChecked).toBe(false);
  });
});
