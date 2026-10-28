import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { safeMerge } from "../src/git/merge.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-merge-"));
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t.t"); await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "a.txt"), "base\n"); await g.add("."); await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("merges a branch into target via temp worktree without disturbing the shared tree", async () => {
  const g = simpleGit(repo);
  const def = (await g.branchLocal()).current;
  await g.checkoutLocalBranch("kp/f1");
  writeFileSync(join(repo, "f.txt"), "feature\n"); await g.add("."); await g.commit("feat");
  await g.checkout(def);
  const r = await safeMerge(repo, def, "kp/f1");
  expect(r.ok).toBe(true);
  expect(await g.raw(["cat-file", "-e", `${def}:f.txt`]).then(() => true).catch(() => false)).toBe(true);
  expect((await g.branchLocal()).current).toBe(def);
  expect(existsSync(join(repo, ".kunpeng", "merge-tmp"))).toBe(false);
});

test("conflict aborts safely and leaves no temp worktree", async () => {
  const g = simpleGit(repo);
  const def = (await g.branchLocal()).current;
  await g.checkoutLocalBranch("kp/c1");
  writeFileSync(join(repo, "a.txt"), "branch-change\n"); await g.add("."); await g.commit("c1");
  await g.checkout(def);
  writeFileSync(join(repo, "a.txt"), "main-change\n"); await g.add("."); await g.commit("m1");
  const r = await safeMerge(repo, def, "kp/c1");
  expect(r.ok).toBe(false);
  expect(existsSync(join(repo, ".kunpeng", "merge-tmp"))).toBe(false);
});

test("merging into the primary tree's current branch updates the working tree on disk (no phantom deletion)", async () => {
  const g = simpleGit(repo);
  const def = (await g.branchLocal()).current;
  await g.checkoutLocalBranch("kp/w1");
  writeFileSync(join(repo, "feat.txt"), "feature\n"); await g.add("."); await g.commit("feat");
  await g.checkout(def);                              // 主工作树停在 def(=合并目标)
  const r = await safeMerge(repo, def, "kp/w1");
  expect(r.ok).toBe(true);
  expect(existsSync(join(repo, "feat.txt"))).toBe(true);  // 文件真落到主工作树磁盘(而非 ref-only 幽灵)
  const status = await g.status();
  expect(status.deleted).toHaveLength(0);                 // 工作树与 ref 一致，无被误判删除
});

test("#3 分支不存在 → 准确报「不存在」而非误报为冲突", async () => {
  const def = (await simpleGit(repo).branchLocal()).current;
  const r = await safeMerge(repo, def, "kp/ghost-never-existed");
  expect(r.ok).toBe(false);
  expect(r.error).toContain("不存在");
  expect(r.error).not.toContain("冲突");
});
