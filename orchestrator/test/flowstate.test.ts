import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-fs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("tracks stage progression and finish with human gate", async () => {
  const t = new FlowTracker(dir);
  await t.start("f1", "build X");
  await t.enter("f1", "implement", true);
  let s = await t.read("f1");
  expect(s?.stage).toBe("implement");
  expect(s?.agentActive).toBe(true);
  await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
  s = await t.read("f1");
  expect(s?.status).toBe("verified");
  expect(s?.agentActive).toBe(false);
  expect(s?.humanGate?.gate).toContain("合并主干");
});

test("block records a blocker and clears agentActive", async () => {
  const t = new FlowTracker(dir);
  await t.start("f2", "broken");
  await t.block("f2", "验收测试审计未通过");
  const s = await t.read("f2");
  expect(s?.blocker).toContain("审计");
  expect(s?.agentActive).toBe(false);
  expect((await t.list()).length).toBe(1);
});

test("records actual backend and fallback status", async () => {
  const t = new FlowTracker(dir);
  await t.start("f3", "uses backend");
  await t.setBackend("f3", "codex", true);
  const s = await t.read("f3");
  expect(s?.backend).toBe("codex");
  expect(s?.fellBack).toBe(true);
});
