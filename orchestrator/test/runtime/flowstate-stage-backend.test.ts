import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { FlowTracker } from "../../src/runtime/flowstate.js";

async function tempStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kunpeng-flow-stage-backend-"));
}

test("setStageBackend 按阶段记后端", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "record stage backends");
  await tracker.setStageBackend("f1", "spec", "claude");
  await tracker.setStageBackend("f1", "implement", "codex");

  expect((await new FlowTracker(dir).read("f1"))?.stageBackends).toEqual({
    spec: "claude",
    implement: "codex",
  });
});

test("覆盖同阶段", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "record stage backends");
  await tracker.setStageBackend("f1", "spec", "claude");
  await tracker.setStageBackend("f1", "spec", "codex");

  expect((await new FlowTracker(dir).read("f1"))?.stageBackends?.spec).toBe("codex");
});

test("流不存在→不抛", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await expect(tracker.setStageBackend("nope", "spec", "claude")).resolves.toBeUndefined();

  expect(await new FlowTracker(dir).list()).toEqual([]);
});
