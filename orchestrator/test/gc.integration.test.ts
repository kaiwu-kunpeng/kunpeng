import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { runGc } from "../src/git/gc.js";

let repo: string;
let git: SimpleGit;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-gc-"));
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

async function createBranchCommit(branch: string, file: string, body: string): Promise<void> {
  await git.checkoutLocalBranch(branch);
  writeFileSync(join(repo, file), body);
  await git.add(".");
  await git.commit(`commit ${branch}`);
}

async function mergeIntoBase(base: string, branch: string): Promise<void> {
  await git.checkout(base);
  await git.merge([branch]);
}

test("deletes merged kp branch and removes it from the repo", async () => {
  const base = await currentBranch();
  await createBranchCommit("kp/feature", "feature.txt", "feature\n");
  await mergeIntoBase(base, "kp/feature");

  const result = await runGc({ repoRoot: repo });

  expect(result.deleted).toContain("kp/feature");
  expect(await hasBranch("kp/feature")).toBe(false);
  expect(existsSync(join(repo, "feature.txt"))).toBe(true);
});

test("keeps unmerged kp branch to avoid data loss", async () => {
  const base = await currentBranch();
  await createBranchCommit("kp/unmerged", "unmerged.txt", "unmerged\n");
  await git.checkout(base);

  const result = await runGc({ repoRoot: repo });

  expect(result.deleted).not.toContain("kp/unmerged");
  expect(result.kept).toContain("kp/unmerged");
  expect(await hasBranch("kp/unmerged")).toBe(true);
});

test("deletes merged kp-stale branch but not ordinary merged branches", async () => {
  const base = await currentBranch();
  await createBranchCommit("kp-stale/x-ts", "stale.txt", "stale\n");
  await mergeIntoBase(base, "kp-stale/x-ts");
  await createBranchCommit("feature/foo", "ordinary.txt", "ordinary\n");
  await mergeIntoBase(base, "feature/foo");

  const result = await runGc({ repoRoot: repo });

  expect(result.deleted).toContain("kp-stale/x-ts");
  expect(result.deleted).not.toContain("feature/foo");
  expect(await hasBranch("kp-stale/x-ts")).toBe(false);
  expect(await hasBranch("feature/foo")).toBe(true);
});

test("dry run reports merged kp branches without deleting them", async () => {
  const base = await currentBranch();
  await createBranchCommit("kp/dry", "dry.txt", "dry\n");
  await mergeIntoBase(base, "kp/dry");

  const result = await runGc({ repoRoot: repo, dryRun: true });

  expect(result.dryRun).toBe(true);
  expect(result.deleted).toContain("kp/dry");
  expect(await hasBranch("kp/dry")).toBe(true);
});

test("#2 gc 清 .kunpeng/cockpit/logs 过期日志、保留近期", async () => {
  const logsDir = join(repo, ".kunpeng", "cockpit", "logs");
  mkdirSync(logsDir, { recursive: true });
  const oldLog = join(logsDir, "old.log"), newLog = join(logsDir, "new.log");
  writeFileSync(oldLog, "x"); writeFileSync(newLog, "y");
  const past = Date.now() / 1000 - 8 * 24 * 3600;   // mtime 8 天前（超 7 天阈值）
  utimesSync(oldLog, past, past);
  const r = await runGc({ repoRoot: repo });
  expect(r.logsDeleted).toBe(1);
  expect(existsSync(oldLog)).toBe(false);   // 过期删
  expect(existsSync(newLog)).toBe(true);    // 近期留
});

test("#2 dry-run 只数过期日志、不真删", async () => {
  const logsDir = join(repo, ".kunpeng", "cockpit", "logs");
  mkdirSync(logsDir, { recursive: true });
  const oldLog = join(logsDir, "old.log");
  writeFileSync(oldLog, "x");
  const past = Date.now() / 1000 - 8 * 24 * 3600;
  utimesSync(oldLog, past, past);
  const r = await runGc({ repoRoot: repo, dryRun: true });
  expect(r.logsDeleted).toBe(1);
  expect(existsSync(oldLog)).toBe(true);    // dry-run 不真删
});
