import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let parent: string, repo: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "kp-bneck-"));
  repo = join(parent, "alpha");
  mkdirSync(repo);
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

test("collectState 的 costSummary 暴露 durationByStage + stageBottlenecks(确定性时钟)", async () => {
  let clock = 0;
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"), () => clock);
  clock = 1000; await tracker.start("f1", "do A");
  clock = 1500; await tracker.enter("f1", "implement", false);
  clock = 2000; await tracker.enter("f1", "verify", false);
  clock = 2300; await tracker.finish("f1", "verified", { gate: "合并主干", what: "x" });

  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  const st = await collectState(store, repo);

  expect(st.costSummary?.durationByStage).toEqual({ spec: 500, implement: 500, verify: 300 });
  const bn = st.costSummary?.stageBottlenecks ?? [];
  expect(bn.length).toBe(3);
  expect(bn[0].label).toBe("spec");
  expect(bn[0].ms).toBe(500);
});