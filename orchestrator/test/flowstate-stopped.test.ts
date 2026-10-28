import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-fs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("markStopped 落 stopped 终态、关 agentActive、不设 blocker、记 history", async () => {
  const t = new FlowTracker(join(dir, "state"));
  await t.start("f1", "做点事");
  await t.enter("f1", "implement", true);
  await t.markStopped("f1");
  const s = (await t.read("f1"))!;
  expect(s.status).toBe("stopped");
  expect(s.agentActive).toBe(false);
  expect(s.blocker).toBeUndefined();              // stopped 非故障：不设 blocker
  expect(s.history.some((h) => h.stage === "stopped")).toBe(true);
});

test("markStopped 对不存在的流是 no-op，不抛", async () => {
  const t = new FlowTracker(join(dir, "state"));
  await expect(t.markStopped("ghost")).resolves.toBeUndefined();
});
