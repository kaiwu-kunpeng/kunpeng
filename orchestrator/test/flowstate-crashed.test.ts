import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-fs-crashed-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("start records owner process and host", async () => {
  const t = new FlowTracker(dir);
  await t.start("f1", "build X");
  const s = await t.read("f1");
  expect(s?.pid).toBe(process.pid);
  expect(s?.host).toBe(os.hostname());
});

test("markCrashed records crashed status without changing current stage", async () => {
  const t = new FlowTracker(dir);
  await t.start("f2", "crashes");
  await t.enter("f2", "implement", true);
  await t.markCrashed("f2");

  const s = await t.read("f2");
  expect(s?.status).toBe("crashed");
  expect(s?.agentActive).toBe(false);
  expect(s?.blocker).toBeTruthy();
  expect(s?.stage).toBe("implement");
  expect(s?.history.at(-1)?.stage).toBe("crashed");
});
