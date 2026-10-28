import { afterEach, beforeEach, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { freshenBranchOntoMain } from "../../src/git/refresh-branch.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-refresh-"));
  const g = simpleGit(repo);
  await g.raw(["init", "--initial-branch=main"]);
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "base.ts"), "base\n");
  await g.add(".");
  await g.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("main 已是祖先 → current, 分支不变", async () => {
  const g = simpleGit(repo);
  await g.checkoutLocalBranch("kp/f1");
  const before = (await g.revparse(["kp/f1"])).trim();

  const result = await freshenBranchOntoMain(repo, "kp/f1");
  const after = (await g.revparse(["kp/f1"])).trim();

  expect(result.status).toBe("current");
  expect(after).toBe(before);
});

test("陈旧分支 + main 有并发新文件 → freshened 且分支吃到新文件", async () => {
  const g = simpleGit(repo);
  await g.checkoutLocalBranch("kp/f2");
  await g.checkout("main");
  writeFileSync(join(repo, "newfile.ts"), "new\n");
  await g.add(".");
  await g.commit("main new file");
  await g.checkout("kp/f2");
  writeFileSync(join(repo, "base.ts"), "branch\n");
  await g.add(".");
  await g.commit("branch change");

  const result = await freshenBranchOntoMain(repo, "kp/f2");
  const hasNewFile = await g.raw(["ls-tree", "kp/f2", "--", "newfile.ts"]).then((out) => out.trim().length > 0);
  const mainIsAncestor = isAncestor("main", "kp/f2");

  expect(result.status).toBe("freshened");
  expect(hasNewFile).toBe(true);
  expect(mainIsAncestor).toBe(true);
});

test("分支与 main 改同一文件同一行冲突 → conflict 且自动清理", async () => {
  const g = simpleGit(repo);
  await g.checkoutLocalBranch("kp/f3");
  writeFileSync(join(repo, "base.ts"), "branch-change\n");
  await g.add(".");
  await g.commit("branch conflict");
  await g.checkout("main");
  writeFileSync(join(repo, "base.ts"), "main-change\n");
  await g.add(".");
  await g.commit("main conflict");

  const result = await freshenBranchOntoMain(repo, "kp/f3");
  const mainIsAncestor = isAncestor("main", "kp/f3");

  expect(result.status).toBe("conflict");
  expect(existsSync(join(repo, ".kunpeng", "freshen-tmp"))).toBe(false);
  expect(mainIsAncestor).toBe(false);
});

test("分支不存在 → error", async () => {
  const result = await freshenBranchOntoMain(repo, "kp/nope");

  expect(result.status).toBe("error");
  expect(result.error).toContain("kp/nope");
});

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
