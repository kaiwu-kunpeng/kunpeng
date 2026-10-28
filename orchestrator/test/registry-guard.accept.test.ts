import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFlowWorktreePath, registerProject, readRegistry } from "../src/project/registry.js";

describe("注册表防污染(作者验收)", () => {
  it("flow worktree 路径识别", () => {
    expect(isFlowWorktreePath("/Users/x/kunpeng/.kunpeng/wt/对话升级-j2-xx-0-0")).toBe(true);
    expect(isFlowWorktreePath("/Users/x/repo/.kunpeng/worktrees/abc")).toBe(true);
    expect(isFlowWorktreePath("/Users/x/kunpeng")).toBe(false);
    expect(isFlowWorktreePath("/Users/x/acme-shop")).toBe(false);
    expect(isFlowWorktreePath("/Users/x/repo/.kunpeng")).toBe(false);
  });
  it("registerProject 拒绝 flow worktree,不落中央表", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "kp-reg-"));
    const wt = join(stateDir, "fake-repo", ".kunpeng", "wt", "某某流-0-0");
    await expect(
      registerProject({ repoPath: wt, stateDir, now: 1 })
    ).rejects.toThrow(/flow worktree/);
    expect((await readRegistry(stateDir)).length).toBe(0);
  });
  it("普通项目照常注册", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "kp-reg2-"));
    const repo = join(stateDir, "normal-repo");
    const entry = await registerProject({ repoPath: repo, stateDir, now: 1 });
    expect(entry.id).toBe("normal-repo");
    expect((await readRegistry(stateDir)).length).toBe(1);
  });
});