import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { reconcileOrphanWorktrees } from "../src/runtime/reconcile.js";

let dir: string;
let git: SimpleGit;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-orphan-worktrees-"));
  git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(dir, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function localBranches(): Promise<string[]> {
  return (await git.branchLocal()).all;
}

test("prunes orphan segment branches while keeping live-plan and standalone branches", async () => {
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await tracker.start("seg-orphan", "orphan segment", { planId: "plan-dead" });
  await tracker.finish("seg-orphan", "verified");
  await git.branch(["kp/seg-orphan"]);

  await tracker.start("seg-live", "live segment", { planId: "plan-alive" });
  await tracker.finish("seg-live", "verified");
  await git.branch(["kp/seg-live"]);
  await git.branch(["kp/plan-alive"]);

  await tracker.start("solo", "standalone flow");
  await tracker.finish("solo", "verified");
  await git.branch(["kp/solo"]);

  const result = await reconcileOrphanWorktrees(dir);
  const branches = await localBranches();

  expect(result.pruned).toContain("seg-orphan");
  expect(result.pruned).not.toContain("seg-live");
  expect(result.pruned).not.toContain("solo");
  expect(branches).not.toContain("kp/seg-orphan");
  expect(branches).toContain("kp/seg-live");
  expect(branches).toContain("kp/solo");
});

test("returns empty result for a non-git directory", async () => {
  const nonGitDir = mkdtempSync(join(tmpdir(), "kp-orphan-worktrees-nongit-"));
  try {
    await expect(reconcileOrphanWorktrees(nonGitDir)).resolves.toEqual({ pruned: [] });
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true });
  }
});
