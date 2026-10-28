import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { reconcileGhostMergeGates } from "../src/runtime/reconcile.js";

let dir: string;
let git: SimpleGit;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-ghost-gates-"));
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

test("clears ghost merge gates while keeping live merge gates", async () => {
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await tracker.start("ghost", "ghost gate");
  await tracker.finish("ghost", "verified", { gate: "合并主干 (人工门#1)", what: "kp/ghost → main" });

  await tracker.start("what-only", "what-only merge gate");
  await tracker.finish("what-only", "verified", { gate: "人工处理", what: "kp/what-only → main" });

  await git.checkoutBranch("kp/live", "main");
  writeFileSync(join(dir, "live.txt"), "x");
  await git.add("live.txt");
  await git.commit("live unique");
  await git.checkout("main");
  await tracker.start("live", "live gate");
  await tracker.finish("live", "verified", { gate: "合并主干 (人工门#1)", what: "kp/live → main" });

  await tracker.start("non-merge", "non-merge gate");
  await tracker.finish("non-merge", "verified", { gate: "批准进化提案 (人工门#2)", what: "proposal-1" });

  const result = await reconcileGhostMergeGates(dir);

  expect(result.cleared).toContain("ghost");
  expect(result.cleared).toContain("what-only");
  expect(result.cleared).not.toContain("live");
  expect(result.cleared).not.toContain("non-merge");
  expect((await tracker.read("ghost"))?.humanGate).toBeUndefined();
  expect((await tracker.read("what-only"))?.humanGate).toBeUndefined();
  expect((await tracker.read("live"))?.humanGate).toBeDefined();
  expect((await tracker.read("non-merge"))?.humanGate).toBeDefined();
});

test("clears a gate whose branch exists but is fully subsumed by main", async () => {
  const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));

  await git.branch(["kp/subsumed"]);
  await tracker.start("subsumed", "subsumed gate");
  await tracker.finish("subsumed", "verified", {
    gate: "合并主干 (人工门#1)",
    what: "kp/subsumed → main",
  });

  const result = await reconcileGhostMergeGates(dir);

  expect(result.cleared).toContain("subsumed");
  expect((await tracker.read("subsumed"))?.humanGate).toBeUndefined();
});

test("returns empty result for a non-git directory without clearing anything", async () => {
  const nonGitDir = mkdtempSync(join(tmpdir(), "kp-ghost-gates-nongit-"));
  try {
    await expect(reconcileGhostMergeGates(nonGitDir)).resolves.toEqual({ cleared: [] });
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true });
  }
});
