import { describe, it, expect } from "vitest";
import { resolveApplyTargetRepo } from "../../src/loop/solution-template.js";

const REG = [
  { id: "acme-shop", repoPath: "/Users/x/acme-shop" },
  { id: "repo", repoPath: "/Users/x/demo-travel" },
];

describe("solution apply 目标仓解析", () => {
  it("注册表命中 → 用项目 repoPath,无视显式 repo", () => {
    expect(resolveApplyTargetRepo("acme-shop", REG, "/tmp/elsewhere")).toBe("/Users/x/acme-shop");
  });

  it("注册表未命中但显式 --repo → 用显式 repo", () => {
    expect(resolveApplyTargetRepo("ghost", REG, "/tmp/explicit")).toBe("/tmp/explicit");
  });

  it("未命中且无显式 repo → 抛错,绝不落 cwd", () => {
    expect(() => resolveApplyTargetRepo("ghost", REG, undefined)).toThrow("ghost");
    expect(() => resolveApplyTargetRepo("ghost", [], "")).toThrow("拒绝");
  });

  it("注册表条目 repoPath 为空串视为未命中", () => {
    expect(resolveApplyTargetRepo("empty", [{ id: "empty", repoPath: " " }], "/tmp/fb")).toBe("/tmp/fb");
  });
});