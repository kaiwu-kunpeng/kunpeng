import { expect, test } from "vitest";
import { assessFlowHealth } from "../src/watchdog/health.js";
import type { FlowSnap } from "../src/watchdog/health.js";

const now = 2_000_000_000_000;
const flows: FlowSnap[] = [
  { flowId: "stuck1", stage: "implement", status: "running", startedAt: now - 700_000, updatedAt: now - 700_000 }, // 700s 没更新 > 10min → stuck
  { flowId: "fresh", stage: "verify", status: "running", startedAt: now - 5_000, updatedAt: now - 5_000 },          // 刚更新 → healthy
  { flowId: "done", stage: "verify", status: "verified", startedAt: now - 999_999, updatedAt: now - 1_000 },        // 非 running → 忽略
];

test("flags stuck running flows (no update past stuckMs); ignores non-running; counts healthy", () => {
  const r = assessFlowHealth(flows, now);
  expect(r.running).toBe(2);
  expect(r.alerts).toHaveLength(1);
  expect(r.alerts[0]).toMatchObject({ flowId: "stuck1", kind: "stuck", stage: "implement" });
  expect(r.healthy).toBe(1);
});

test("long-running (updated recently but started long ago) → long-running alert, not stuck", () => {
  const f: FlowSnap[] = [{ flowId: "long", stage: "implement", status: "running", startedAt: now - 2_000_000, updatedAt: now - 1_000 }];
  const r = assessFlowHealth(f, now);
  expect(r.alerts[0].kind).toBe("long-running");
});
