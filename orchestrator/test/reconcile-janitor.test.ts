import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { runPatrol } from "../src/loop/patrol.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { reconcileStaleArtifacts } from "../src/runtime/reconcile.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-reconcile-janitor-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function patchFlow(stateDir: string, flowId: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(stateDir, `${flowId}.json`);
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...state, ...patch }, null, 2), "utf8");
}

function trackerAt(stateDir: string): FlowTracker {
  return new FlowTracker(stateDir, () => 1_700_000_000_000);
}

test("reconcileStaleArtifacts clears blocker from terminal rolled-back flows", async () => {
  const tracker = trackerAt(dir);
  await tracker.start("done", "rolled back with stale blocker");
  await patchFlow(dir, "done", { status: "rolled-back", blocker: "already resolved" });

  const result = await reconcileStaleArtifacts(tracker);

  expect(result.cleared).toEqual(["done"]);
  expect((await tracker.read("done"))?.blocker).toBeUndefined();
});

test("reconcileStaleArtifacts keeps blocker on crashed flows", async () => {
  const tracker = trackerAt(dir);
  await tracker.start("crashed", "crashed flow");
  await tracker.markCrashed("crashed");

  const result = await reconcileStaleArtifacts(tracker);

  expect(result.cleared).not.toContain("crashed");
  expect((await tracker.read("crashed"))?.blocker).toBeTruthy();
});

test("reconcileStaleArtifacts keeps blocker on running flows", async () => {
  const tracker = trackerAt(dir);
  await tracker.start("running", "running flow");
  await tracker.block("running", "still active");

  const result = await reconcileStaleArtifacts(tracker);

  expect(result.cleared).not.toContain("running");
  expect((await tracker.read("running"))?.blocker).toBe("still active");
});

test("reconcileStaleArtifacts keeps blocker on stopped flows (用户停掉卡住的流, 原因须留存)", async () => {
  const tracker = trackerAt(dir);
  await tracker.start("stopped", "blocked then stopped by user");
  await tracker.block("stopped", "验收测试审计未通过");
  await tracker.markStopped("stopped");

  const result = await reconcileStaleArtifacts(tracker);

  expect(result.cleared).not.toContain("stopped");
  expect((await tracker.read("stopped"))?.blocker).toBe("验收测试审计未通过");
});

test("reconcileStaleArtifacts is idempotent", async () => {
  const tracker = trackerAt(dir);
  await tracker.start("done", "rolled back with stale blocker");
  await patchFlow(dir, "done", { status: "rolled-back", blocker: "already resolved" });

  const first = await reconcileStaleArtifacts(tracker);
  const second = await reconcileStaleArtifacts(tracker);

  expect(first.cleared).toEqual(["done"]);
  expect(second.cleared).toEqual([]);
  expect((await tracker.read("done"))?.history.filter((h) => h.stage === "blocker-cleared")).toHaveLength(1);
});

test("runPatrol runs janitor when tracker is injected and remains compatible without tracker", async () => {
  const stateDir = join(dir, "state");
  const tracker = trackerAt(stateDir);
  const store = new ArtifactStore(join(dir, "artifacts"));
  await tracker.start("done", "rolled back with stale blocker");
  await patchFlow(stateDir, "done", { status: "rolled-back", blocker: "already resolved" });

  const withTracker = await runPatrol({ store, tracker, now: () => 1 });

  expect(withTracker.staleCleared).toBeGreaterThanOrEqual(1);
  expect((await tracker.read("done"))?.blocker).toBeUndefined();

  const withoutTracker = await runPatrol({ store, now: () => 2 });
  expect(withoutTracker.staleCleared).toBe(0);
});
