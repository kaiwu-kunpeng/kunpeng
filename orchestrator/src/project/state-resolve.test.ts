import { expect, it } from "vitest";
import { join } from "node:path";
import { canonicalRepoRoot, resolveProjectStateDir } from "./state-resolve.js";
import type { ProjectEntry } from "./registry.js";

const reg: ProjectEntry[] = [
  { id: "kunpeng", name: "鲲鹏", repoPath: "/Users/x/kunpeng", registeredAt: 1 },
];

it("子 worktree 经 git-common-dir 映射回主仓根", () => {
  const root = canonicalRepoRoot("/Users/x/kunpeng-wt", {
    runGit: () => "/Users/x/kunpeng/.git",
  });
  expect(root).toBe("/Users/x/kunpeng");
});

it("子 worktree 的 flow 状态解析到注册项目 canonical state dir", () => {
  const dir = resolveProjectStateDir("/Users/x/kunpeng-wt", {
    runGit: () => "/Users/x/kunpeng/.git",
    readRegistrySync: () => reg,
  });
  expect(dir).toBe(join("/Users/x/kunpeng", ".kunpeng", "state"));
});

it("主仓自身(common-dir=主仓/.git)解析到自己的 state dir", () => {
  const dir = resolveProjectStateDir("/Users/x/kunpeng", {
    runGit: () => "/Users/x/kunpeng/.git",
    readRegistrySync: () => reg,
  });
  expect(dir).toBe(join("/Users/x/kunpeng", ".kunpeng", "state"));
});

it("未注册项目 → 回退到自身 state dir（向后兼容）", () => {
  const dir = resolveProjectStateDir("/tmp/random-repo", {
    runGit: () => "/tmp/random-repo/.git",
    readRegistrySync: () => reg,
  });
  expect(dir).toBe(join("/tmp/random-repo", ".kunpeng", "state"));
});

it("git 失败(runGit 返 null) → 回退到自身 state dir，不抛", () => {
  const dir = resolveProjectStateDir("/Users/x/kunpeng-wt", {
    runGit: () => null,
    readRegistrySync: () => reg,
  });
  expect(dir).toBe(join("/Users/x/kunpeng-wt", ".kunpeng", "state"));
});