import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import { diagnoseGate } from "../../src/runtime/gate-diagnosis.js";
import { gitGateAdapter } from "../../src/runtime/gate-git.js";

const execFileAsync = promisify(execFile);

let repo: string;

async function git(args: string[]) {
  return execFileAsync("git", ["-C", repo, ...args]);
}

async function commit(message: string) {
  await git(["add", "."]);
  await git(["commit", "-m", message]);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-gate-git-"));

  await git(["init"]);
  await git(["config", "user.email", "t@t.t"]);
  await git(["config", "user.name", "t"]);
  await git(["checkout", "-b", "main"]);

  writeFileSync(join(repo, "a.txt"), "base-a\n");
  writeFileSync(join(repo, "conflict.txt"), "base\n");
  await commit("init");

  await git(["checkout", "-b", "kp/clean"]);
  writeFileSync(join(repo, "a.txt"), "clean-a\n");
  await commit("clean");

  await git(["checkout", "main"]);
  await git(["checkout", "-b", "kp/conflict"]);
  writeFileSync(join(repo, "conflict.txt"), "branch-change\n");
  await commit("conflict");

  await git(["checkout", "main"]);
  writeFileSync(join(repo, "conflict.txt"), "main-change\n");
  await commit("main conflict side");
  writeFileSync(join(repo, "main-extra.txt"), "extra\n");
  await commit("main extra");
  await git(["branch", "kp/included", "main"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("branchExists:存在 true、不存在 false", async () => {
  const adapter = gitGateAdapter(repo);

  await expect(adapter.branchExists("kp/clean")).resolves.toBe(true);
  await expect(adapter.branchExists("kp/nope")).resolves.toBe(false);
});

test("unmergedCommits:有独立 commit→>0;已并入→0", async () => {
  const adapter = gitGateAdapter(repo);

  await expect(adapter.unmergedCommits("kp/clean", "main")).resolves.toBeGreaterThan(0);
  await expect(adapter.unmergedCommits("kp/included", "main")).resolves.toBe(0);
});

test("commitsBehind:main 比分支多 N → N", async () => {
  await expect(gitGateAdapter(repo).commitsBehind("kp/clean", "main")).resolves.toBe(2);
});

test("mergeConflictFiles:冲突分支→含冲突文件;干净→[]", async () => {
  const adapter = gitGateAdapter(repo);

  await expect(adapter.mergeConflictFiles("kp/conflict", "main")).resolves.toContain("conflict.txt");
  await expect(adapter.mergeConflictFiles("kp/clean", "main")).resolves.toEqual([]);
});

test("配合 diagnoseGate:conflict 分支→stale-conflict", async () => {
  await expect(diagnoseGate(gitGateAdapter(repo), "conflict")).resolves.toMatchObject({
    status: "stale-conflict",
    conflictFiles: ["conflict.txt"],
  });
});
