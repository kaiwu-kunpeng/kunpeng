import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { runGc } from "../src/git/gc.js";

let repo: string;
let git: SimpleGit;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-gc-base-"));
  git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

async function currentBranch(): Promise<string> {
  return (await git.branchLocal()).current;
}

async function hasBranch(branch: string): Promise<boolean> {
  return (await git.branchLocal()).all.includes(branch);
}

async function makeMergedBranch(base: string, branch: string, file: string): Promise<void> {
  await git.checkout(base);
  await git.checkoutLocalBranch(branch);
  writeFileSync(join(repo, file), `${branch}\n`);
  await git.add(".");
  await git.commit(`commit ${branch}`);
  await git.checkout(base);
  await git.merge([branch]);
}

/** 复刻 ADR-0011 布局:工作树 detach 在落后 base 的旧 commit 上。 */
async function detachBehind(base: string, staleHead: string): Promise<void> {
  await git.checkout(base);
  writeFileSync(join(repo, "advance.txt"), "advance\n");
  await git.add(".");
  await git.commit("advance base beyond stale head");
  await git.checkout([staleHead, "--detach"]);
}

test("HEAD 落后 base 时,已并入 base 的 kp 分支仍被删掉", async () => {
  const base = await currentBranch();
  const staleHead = (await git.revparse(["HEAD"])).trim();
  await makeMergedBranch(base, "kp/feature", "feature.txt");
  await detachBehind(base, staleHead);

  const result = await runGc({ repoRoot: repo, base });

  expect(result.deleted).toContain("kp/feature");
  expect(await hasBranch("kp/feature")).toBe(false);
});

test("未并入 base 的 kp 分支绝不删(-D 不得变成无差别删除)", async () => {
  const base = await currentBranch();
  await git.checkoutLocalBranch("kp/unmerged");
  writeFileSync(join(repo, "u.txt"), "u\n");
  await git.add(".");
  await git.commit("commit kp/unmerged");
  await git.checkout(base);

  const result = await runGc({ repoRoot: repo, base });

  expect(result.deleted).not.toContain("kp/unmerged");
  expect(await hasBranch("kp/unmerged")).toBe(true);
});

test("非 kp 前缀的分支不受影响", async () => {
  const base = await currentBranch();
  const staleHead = (await git.revparse(["HEAD"])).trim();
  await makeMergedBranch(base, "feature/keep-me", "keep.txt");
  await detachBehind(base, staleHead);

  const result = await runGc({ repoRoot: repo, base });

  expect(result.deleted).not.toContain("feature/keep-me");
  expect(await hasBranch("feature/keep-me")).toBe(true);
});

test("dry-run 预告的集合与真删的集合一致", async () => {
  const base = await currentBranch();
  const staleHead = (await git.revparse(["HEAD"])).trim();
  await makeMergedBranch(base, "kp/one", "one.txt");
  await makeMergedBranch(base, "kp/two", "two.txt");
  await detachBehind(base, staleHead);

  const dry = await runGc({ repoRoot: repo, base, dryRun: true });
  const real = await runGc({ repoRoot: repo, base });

  expect([...dry.deleted].sort()).toEqual(["kp/one", "kp/two"]);
  expect([...real.deleted].sort()).toEqual([...dry.deleted].sort());
});