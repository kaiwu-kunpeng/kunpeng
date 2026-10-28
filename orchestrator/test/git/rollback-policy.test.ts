import { describe, it, expect } from "vitest";
import { rollbackPolicy } from "../../src/git/rollback-policy.js";

describe("rollbackPolicy", () => {
  it("不设开关时照旧清干净", () => {
    expect(rollbackPolicy(undefined)).toEqual({
      removeWorktree: true,
      deleteBranch: true,
      reason: "cleaned",
    });
  });

  it("设成 1 时 worktree 与分支都保留", () => {
    expect(rollbackPolicy("1")).toEqual({
      removeWorktree: false,
      deleteBranch: false,
      reason: "kept-by-env",
    });
  });

  it("设成 0 时仍然清干净", () => {
    expect(rollbackPolicy("0")).toEqual({
      removeWorktree: true,
      deleteBranch: true,
      reason: "cleaned",
    });
  });

  it("设成其他任意值时仍然清干净（只有 1 才留）", () => {
    expect(rollbackPolicy("true").reason).toBe("cleaned");
    expect(rollbackPolicy("yes").reason).toBe("cleaned");
    expect(rollbackPolicy("").reason).toBe("cleaned");
  });

  it("保留与删除两种策略的三个字段互相一致", () => {
    const kept = rollbackPolicy("1");
    expect(kept.removeWorktree).toBe(false);
    expect(kept.deleteBranch).toBe(false);
    const cleaned = rollbackPolicy(undefined);
    expect(cleaned.removeWorktree).toBe(true);
    expect(cleaned.deleteBranch).toBe(true);
  });
});