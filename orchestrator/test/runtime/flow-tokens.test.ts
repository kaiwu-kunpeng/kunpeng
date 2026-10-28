import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { FlowTracker } from "../../src/runtime/flowstate.js";

async function tempStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kunpeng-flow-tokens-"));
}

test("FlowTracker.addTokens persists cumulative token usage", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count tokens");
  await tracker.addTokens("f1", 1000);

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBe(1000);

  await tracker.addTokens("f1", 540);

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBe(1540);
});

test("FlowTracker.addTokens ignores non-positive and non-finite token values", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count tokens");
  await tracker.addTokens("f1", 1540);
  await tracker.addTokens("f1", -5);
  await tracker.addTokens("f1", NaN);
  await tracker.addTokens("f1", 0);
  await tracker.addTokens("f1", Infinity);
  await tracker.addTokens("f1", -Infinity);

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBe(1540);
});

test("FlowTracker.addTokens silently ignores missing flows", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count tokens");
  await expect(tracker.addTokens("nope", 100)).resolves.toBeUndefined();

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBeUndefined();
});

test("FlowTracker.addTokens starts from zero when an existing flow lacks tokensUsed", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count tokens");
  const path = join(dir, "f1.json");
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  delete state.tokensUsed;
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBeUndefined();

  await tracker.addTokens("f1", 100);

  expect((await new FlowTracker(dir).read("f1"))?.tokensUsed).toBe(100);
});

test("FlowTracker.addStageTokens persists cumulative stage token usage", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count stage tokens");
  await tracker.addStageTokens("f1", "implement", 1000);
  await tracker.addStageTokens("f1", "implement", 1000);
  await tracker.addStageTokens("f1", "spec", 200);

  expect((await new FlowTracker(dir).read("f1"))?.stageTokens).toEqual({
    implement: 2000,
    spec: 200,
  });
});

test("FlowTracker.addStageTokens ignores invalid values and missing flows without changing total tokens", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count stage tokens");
  await tracker.addTokens("f1", 1540);
  await tracker.addStageTokens("f1", "implement", 1000);
  await tracker.addStageTokens("f1", "implement", -5);
  await tracker.addStageTokens("f1", "implement", NaN);
  await tracker.addStageTokens("f1", "implement", 0);
  await tracker.addStageTokens("f1", "implement", Infinity);
  await tracker.addStageTokens("f1", "implement", -Infinity);
  await expect(tracker.addStageTokens("nope", "spec", 100)).resolves.toBeUndefined();

  const state = await new FlowTracker(dir).read("f1");
  expect(state?.stageTokens).toEqual({ implement: 1000 });
  expect(state?.tokensUsed).toBe(1540);
});

test("FlowTracker.addTokens does not create stageTokens", async () => {
  const dir = await tempStateDir();
  const tracker = new FlowTracker(dir);

  await tracker.start("f1", "count tokens");
  await tracker.addTokens("f1", 100);

  expect((await new FlowTracker(dir).read("f1"))?.stageTokens).toBeUndefined();
});
