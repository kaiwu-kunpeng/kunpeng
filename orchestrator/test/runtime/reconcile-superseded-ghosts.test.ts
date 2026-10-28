import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { reconcileSupersededGhosts } from "../../src/runtime/reconcile.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-reconcile-ghosts-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tracker(): FlowTracker {
  return new FlowTracker(join(dir, "state"), () => 1_700_000_000_000);
}

async function crashedFlow(t: FlowTracker, flowId: string): Promise<void> {
  await t.start(flowId, `requirement for ${flowId}`);
  await t.enter(flowId, "implement", true);
  await t.markCrashed(flowId);
}

test("retires crashed ghost when its branch no longer exists", async () => {
  const t = tracker();
  await crashedFlow(t, "missing-branch");

  const result = await reconcileSupersededGhosts(t, dir, {
    hasBranch: async () => false,
  });

  const flow = await t.read("missing-branch");
  expect(result.retired).toEqual(["missing-branch"]);
  expect(flow?.status).toBe("rolled-back");
  expect(flow?.stage).toBe("done");
  expect(flow?.blocker).toBeUndefined();
  expect(flow?.history.map((h) => h.stage)).toEqual([
    "spec",
    "implement",
    "crashed",
    "retired-superseded",
  ]);
});

test("retires crashed ghost when its branch is fully subsumed by main", async () => {
  const t = tracker();
  await crashedFlow(t, "subsumed");

  const result = await reconcileSupersededGhosts(t, dir, {
    hasBranch: async (branch) => branch === "kp/subsumed",
    isSubsumed: async () => true,
  });

  expect(result.retired).toEqual(["subsumed"]);
  expect((await t.read("subsumed"))?.status).toBe("rolled-back");
  expect((await t.read("subsumed"))?.history.some((h) => h.stage === "retired-superseded")).toBe(true);
});

test("keeps crashed flow red when its branch exists and is not subsumed", async () => {
  const t = tracker();
  await crashedFlow(t, "live-crash");

  const result = await reconcileSupersededGhosts(t, dir, {
    hasBranch: async () => true,
    isSubsumed: async () => false,
  });

  const flow = await t.read("live-crash");
  expect(result.retired).toEqual([]);
  expect(flow?.status).toBe("crashed");
  expect(flow?.blocker).toBeTruthy();
  expect(flow?.history.some((h) => h.stage === "retired-superseded")).toBe(false);
});

test("does not touch non-crashed flows", async () => {
  const t = tracker();
  await t.start("verified", "already done");
  await t.finish("verified", "verified");
  await t.start("running", "still running");

  const result = await reconcileSupersededGhosts(t, dir, {
    hasBranch: async () => false,
    isSubsumed: async () => true,
  });

  expect(result.retired).toEqual([]);
  expect((await t.read("verified"))?.status).toBe("verified");
  expect((await t.read("running"))?.status).toBe("running");
  expect((await t.read("verified"))?.history.some((h) => h.stage === "retired-superseded")).toBe(false);
  expect((await t.read("running"))?.history.some((h) => h.stage === "retired-superseded")).toBe(false);
});
