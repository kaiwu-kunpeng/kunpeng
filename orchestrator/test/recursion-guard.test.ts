import { describe, expect, it } from "vitest";
import { sep } from "node:path";
import { recursionGuardReason } from "../src/cli.js";

const wt = ["/Users/x/proj", ".kunpeng", "wt", "flow-a"].join(sep);
const root = "/Users/x/proj";

describe("递归守卫 recursionGuardReason", () => {
  it("KUNPENG_IN_FLOW 环境标记命中 run/plan", () => {
    expect(recursionGuardReason("run", root, root, { KUNPENG_IN_FLOW: "1" })).toContain("KUNPENG_IN_FLOW");
    expect(recursionGuardReason("plan", root, root, { KUNPENG_IN_FLOW: "1" })).toContain("KUNPENG_IN_FLOW");
  });

  it("cwd 在 flow worktree 内命中", () => {
    expect(recursionGuardReason("run", wt, root, {})).toContain("flow worktree");
  });

  it("目标仓库(repoRoot)在 flow worktree 内命中", () => {
    expect(recursionGuardReason("plan", root, wt, {})).toContain("flow worktree");
  });

  it("顶层正常派发不拦", () => {
    expect(recursionGuardReason("run", root, root, {})).toBeUndefined();
    expect(recursionGuardReason("plan", "/Users/x/proj-b", "/Users/x/proj-b", {})).toBeUndefined();
  });

  it("非派发类命令(board/merge)即使在 worktree 内也不拦", () => {
    expect(recursionGuardReason("board", wt, wt, { KUNPENG_IN_FLOW: "1" })).toBeUndefined();
    expect(recursionGuardReason("merge", wt, wt, {})).toBeUndefined();
    expect(recursionGuardReason(undefined, wt, wt, {})).toBeUndefined();
  });
});
