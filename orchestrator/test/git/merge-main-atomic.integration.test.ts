import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { afterEach, beforeEach, expect, test } from "vitest";
import { mergeIntoMainAtomic } from "../../src/git/merge-main-atomic.js";

let repo: string;
let g: SimpleGit;

async function commitFile(path: string, content: string, message: string): Promise<string> {
  writeFileSync(join(repo, path), content);
  await g.add(".");
  await g.commit(message);
  return (await g.revparse(["HEAD"])).trim();
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-merge-atomic-"));
  g = simpleGit(repo);
  await g.init();
  await g.checkoutLocalBranch("main");
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  await commitFile("a.txt", "base\n", "init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("干净合并 -> ok, main 前进且 before 是其父", async () => {
  const before = (await g.revparse(["refs/heads/main"])).trim();

  await g.checkoutLocalBranch("kp/a");
  await commitFile("feature.txt", "feature\n", "feat");
  await g.checkout("main");

  const result = await mergeIntoMainAtomic(repo, "kp/a");
  const mainHead = (await g.revparse(["refs/heads/main"])).trim();
  const parents = (await g.raw(["rev-list", "--parents", "-1", "main"])).trim().split(/\s+/);

  expect(result.ok).toBe(true);
  expect(result.merged).toBeTruthy();
  expect(mainHead).toBe(result.merged);
  expect(parents[0]).toBe(result.merged);
  expect(parents).toContain(before);
});

test("CAS 竞争 -> raced 且 main 不被污染", async () => {
  await g.checkoutLocalBranch("kp/b");
  await commitFile("feature.txt", "feature\n", "feat");
  await g.checkout("main");

  const before = (await g.revparse(["refs/heads/main"])).trim();
  const concurrent = await commitFile("concurrent.txt", "concurrent\n", "concurrent");

  const result = await mergeIntoMainAtomic(repo, "kp/b", "main", { expectedHead: before });
  const mainHead = (await g.revparse(["refs/heads/main"])).trim();

  expect(result.ok).toBe(false);
  expect(result.raced).toBe(true);
  expect(mainHead).toBe(concurrent);
  expect(mainHead).not.toBe(result.merged);
});

test("冲突 -> conflict 且清理 worktree", async () => {
  const before = (await g.revparse(["refs/heads/main"])).trim();

  await g.checkoutLocalBranch("kp/c");
  await commitFile("a.txt", "branch-change\n", "branch change");
  await g.checkout("main");
  await commitFile("a.txt", "main-change\n", "main change");
  const mainBeforeMerge = (await g.revparse(["refs/heads/main"])).trim();

  const result = await mergeIntoMainAtomic(repo, "kp/c");
  const mainHead = (await g.revparse(["refs/heads/main"])).trim();

  expect(mainBeforeMerge).not.toBe(before);
  expect(result.ok).toBe(false);
  expect(result.conflict).toBe(true);
  expect(existsSync(join(repo, ".kunpeng", "merge-atomic-tmp"))).toBe(false);
  expect(mainHead).toBe(mainBeforeMerge);
});

test("分支不存在 -> ok:false 且带可诊断 error", async () => {
  const result = await mergeIntoMainAtomic(repo, "kp/ghost-never-existed");

  expect(result.ok).toBe(false);
  expect(result.error).toContain("不存在");
});
