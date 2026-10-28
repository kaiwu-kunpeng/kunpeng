import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runGc } from "../src/git/gc.js";

let repo: string;
let git: SimpleGit;
let baseBranch: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-gc-checkpoint-tags-"));
  git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
  baseBranch = (await git.branchLocal()).current;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

async function checkpointTags(): Promise<string[]> {
  return (await git.tags()).all.filter((tag) => tag.startsWith("kp-ckpt/"));
}

test("deletes checkpoint tags for terminal flows and keeps tags for flows with a local branch", async () => {
  await git.addTag("kp-ckpt/flowA/step1");
  await git.addTag("kp-ckpt/flowA/step2");

  await git.checkoutLocalBranch("kp/flowB");
  writeFileSync(join(repo, "flow-b.txt"), "in progress\n");
  await git.add(".");
  await git.commit("flowB in progress");
  await git.addTag("kp-ckpt/flowB/step1");
  await git.checkout(baseBranch);

  const result = await runGc({ repoRoot: repo });
  const tags = await checkpointTags();

  expect(tags).not.toContain("kp-ckpt/flowA/step1");
  expect(tags).not.toContain("kp-ckpt/flowA/step2");
  expect(tags).toContain("kp-ckpt/flowB/step1");
  expect(result.deletedTags).toEqual([
    "kp-ckpt/flowA/step1",
    "kp-ckpt/flowA/step2",
  ]);
  expect(result.deletedTags).not.toContain("kp-ckpt/flowB/step1");
});

test("returns an empty deletedTags list when the repo has no checkpoint tags", async () => {
  await expect(runGc({ repoRoot: repo })).resolves.toMatchObject({ deletedTags: [] });
});

test("dry run reports terminal checkpoint tags without deleting them", async () => {
  await git.addTag("kp-ckpt/flowA/step1");

  const result = await runGc({ repoRoot: repo, dryRun: true });

  expect(result.deletedTags).toEqual(["kp-ckpt/flowA/step1"]);
  expect(await checkpointTags()).toContain("kp-ckpt/flowA/step1");
});
