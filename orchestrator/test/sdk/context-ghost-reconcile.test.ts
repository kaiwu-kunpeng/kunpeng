import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { createContext } from "../../src/sdk/context.js";

let repoRoot: string;
let git: SimpleGit;

beforeEach(async () => {
  repoRoot = mkdtempSync(join(tmpdir(), "kp-context-ghost-"));
  git = simpleGit(repoRoot);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repoRoot, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("createContext clears a ghost merge gate already subsumed by main", async () => {
  const tracker = new FlowTracker(join(repoRoot, ".kunpeng", "state"));
  await git.branch(["kp/g1"]);
  await tracker.start("g1", "ghost merge gate");
  await tracker.finish("g1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/g1 → main" });

  await createContext(repoRoot, repoRoot);

  const flows = await tracker.list();
  expect(flows.find((flow) => flow.flowId === "g1")?.humanGate).toBeUndefined();
});

test("createContext still returns when ghost gate reconciliation cannot inspect git branches", async () => {
  const nonGitRoot = mkdtempSync(join(tmpdir(), "kp-context-ghost-nongit-"));
  try {
    const ctx = await createContext(nonGitRoot, nonGitRoot);

    expect(ctx.tracker).toBeInstanceOf(FlowTracker);
  } finally {
    rmSync(nonGitRoot, { recursive: true, force: true });
  }
});
