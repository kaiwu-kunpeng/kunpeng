import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { reconcileReposBestEffort } from "../../src/runtime/reconcile.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-reconcile-startup-ghosts-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function initRepo(name: string): Promise<string> {
  const repo = join(dir, name);
  mkdirSync(repo, { recursive: true });
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
  return repo;
}

async function crashedFlow(repo: string, flowId: string): Promise<FlowTracker> {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  await tracker.start(flowId, `crashed startup ghost ${flowId}`);
  await tracker.markCrashed(flowId);
  return tracker;
}

test("startup reconcile retires crashed ghost whose branch no longer exists", async () => {
  const repo = await initRepo("repo-missing-branch");
  const tracker = await crashedFlow(repo, "missing-branch");

  await expect(reconcileReposBestEffort([repo])).resolves.toBeUndefined();

  const flow = await tracker.read("missing-branch");
  expect(flow?.status).toBe("rolled-back");
  expect(flow?.stage).toBe("done");
  expect(flow?.blocker).toBeUndefined();
  expect(flow?.history.map((h) => h.stage)).toContain("retired-superseded");
});

test("startup reconcile retires crashed ghost whose branch is already subsumed by main", async () => {
  const repo = await initRepo("repo-subsumed-branch");
  await simpleGit(repo).branch(["kp/subsumed"]);
  const tracker = await crashedFlow(repo, "subsumed");

  await expect(reconcileReposBestEffort([repo])).resolves.toBeUndefined();

  const flow = await tracker.read("subsumed");
  expect(flow?.status).toBe("rolled-back");
  expect(flow?.stage).toBe("done");
  expect(flow?.blocker).toBeUndefined();
  expect(flow?.history.map((h) => h.stage)).toContain("retired-superseded");
});

