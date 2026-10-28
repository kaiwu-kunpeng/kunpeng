import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { reconcileDeadFlows, reconcileReposBestEffort } from "../src/runtime/reconcile.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-reconcile-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function patchFlow(stateDir: string, flowId: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(stateDir, `${flowId}.json`);
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...state, ...patch }, null, 2), "utf8");
}

test("reconcileDeadFlows marks only local dead running flows as crashed", async () => {
  const tracker = new FlowTracker(dir);
  await tracker.start("dead", "dead flow");
  await tracker.start("alive", "alive flow");
  await tracker.start("legacy", "legacy flow");
  await tracker.start("remote", "remote flow");

  await patchFlow(dir, "dead", { pid: 10, host: os.hostname() });
  await patchFlow(dir, "alive", { pid: 20, host: os.hostname() });
  await patchFlow(dir, "legacy", { pid: undefined });
  await patchFlow(dir, "remote", { pid: 30, host: "other-host" });

  const result = await reconcileDeadFlows(tracker, { isAlive: (pid) => pid === 20 });

  expect(result.reconciled).toEqual(["dead"]);
  expect((await tracker.read("dead"))?.status).toBe("crashed");
  expect((await tracker.read("alive"))?.status).toBe("running");
  expect((await tracker.read("legacy"))?.status).toBe("running");
  expect((await tracker.read("remote"))?.status).toBe("running");
});

test("reconcileReposBestEffort skips broken repos and reconciles valid repos", async () => {
  const repo = join(dir, "repo");
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  await tracker.start("dead", "dead flow");
  await patchFlow(join(repo, ".kunpeng", "state"), "dead", { pid: 2_147_483_647, host: os.hostname() });

  await expect(reconcileReposBestEffort(["/no/such/dir/kp-reconcile", repo])).resolves.toBeUndefined();

  expect((await tracker.read("dead"))?.status).toBe("crashed");
});

test("reconcileReposBestEffort retires crashed ghosts already subsumed by main", async () => {
  const repo = join(dir, "repo-subsumed");
  mkdirSync(repo, { recursive: true });
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
  await git.branch(["kp/subsumed"]);

  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  await tracker.start("subsumed", "dead but merged flow");
  await tracker.markCrashed("subsumed");

  await expect(reconcileReposBestEffort([repo])).resolves.toBeUndefined();

  const flow = await tracker.read("subsumed");
  expect(flow?.status).toBe("rolled-back");
  expect(flow?.stage).toBe("done");
  expect(flow?.blocker).toBeUndefined();
  expect(flow?.history.some((h) => h.stage === "retired-superseded")).toBe(true);
});
