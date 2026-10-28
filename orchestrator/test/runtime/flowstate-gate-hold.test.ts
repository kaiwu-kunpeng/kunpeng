import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-gate-hold-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("setGateHold 落盘不推 history；clearGate 与重新挂门都清掉它；未知流静默", async () => {
  const t = new FlowTracker(join(dir, "state"), () => 1_700_000_000_000);
  await t.start("h1", "req");
  await t.finish("h1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/h1 → main" });
  const before = (await t.read("h1"))!.history.length;
  await t.setGateHold("h1", { kind: "guard-red", reason: "× x", at: 5 });
  let s = (await t.read("h1"))!;
  expect(s.gateHold).toEqual({ kind: "guard-red", reason: "× x", at: 5 });
  expect(s.history.length).toBe(before);
  await t.clearGate("h1", { by: "human", via: "test" });
  s = (await t.read("h1"))!;
  expect(s.gateHold).toBeUndefined();
  await t.setGateHold("h1", { kind: "hook-failed", reason: "exit 3", at: 6 });
  await t.finish("h1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/h1 → main" });
  expect((await t.read("h1"))!.gateHold).toBeUndefined();
  await expect(t.setGateHold("nope", { kind: "guard-red", reason: "", at: 1 })).resolves.toBeUndefined();
  expect(await t.read("nope")).toBeNull();
});