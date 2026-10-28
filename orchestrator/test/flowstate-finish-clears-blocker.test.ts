import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";

let dir: string;
let tick: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-fs-"));
  tick = 1_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tracker() {
  return new FlowTracker(join(dir, "state"), () => tick++);
}

test("finish(verified) clears blocker", async () => {
  const t = tracker();
  await t.start("f1", "build X");
  await t.block("f1", "boom");

  let s = await t.read("f1");
  expect(s?.blocker).toBe("boom");

  await t.finish("f1", "verified");
  s = await t.read("f1");
  expect(s?.status).toBe("verified");
  expect(s?.blocker).toBeUndefined();
});

test("finish(rolled-back) clears blocker", async () => {
  const t = tracker();
  await t.start("f2", "roll back X");
  await t.block("f2", "boom");

  let s = await t.read("f2");
  expect(s?.blocker).toBe("boom");

  await t.finish("f2", "rolled-back");
  s = await t.read("f2");
  expect(s?.status).toBe("rolled-back");
  expect(s?.blocker).toBeUndefined();
});

test("markCrashed keeps blocker", async () => {
  const t = tracker();
  await t.start("f3", "crash X");
  await t.markCrashed("f3");

  const s = await t.read("f3");
  expect(s?.status).toBe("crashed");
  expect(s?.blocker).toEqual(expect.any(String));
  expect(s?.blocker).not.toBe("");
});

test("clearBlocker clears blocker and records history", async () => {
  const t = tracker();
  await t.start("f4", "clear blocker");
  await t.block("f4", "x");
  await t.clearBlocker("f4");

  const s = await t.read("f4");
  expect(s?.blocker).toBeUndefined();
  expect(s?.history.some((h) => h.stage === "blocker-cleared")).toBe(true);
});

test("clearBlocker is idempotent without blocker history noise", async () => {
  const t = tracker();
  await t.start("f5", "already clear");
  const before = await t.read("f5");

  await expect(t.clearBlocker("f5")).resolves.toBeUndefined();

  const after = await t.read("f5");
  expect(after?.history.filter((h) => h.stage === "blocker-cleared")).toHaveLength(0);
  expect(after?.history).toEqual(before?.history);
});

