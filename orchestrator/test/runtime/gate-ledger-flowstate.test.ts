import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker, parseDurationTier } from "../../src/runtime/flowstate.js";

let dir: string;
let clock = 0;
const tracker = () => new FlowTracker(dir, () => clock);
const GATE = { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-gate-ledger-")); clock = 0; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("门的开门时间与清门归因账本", () => {
  it("finish 带门 → gateOpenedAt=当时；humanGate 形状不变", async () => {
    const t = tracker();
    clock = 1000; await t.start("f1", "req");
    clock = 5000; await t.finish("f1", "verified", GATE);
    const s = (await t.read("f1"))!;
    expect(s.gateOpenedAt).toBe(5000);
    expect(s.humanGate).toEqual(GATE);
    expect(s.gateLedger).toBeUndefined();
  });

  it("clearGate 带署名 → 账本一条含 by/via/tier/时长；门与 gateOpenedAt 清掉；history 末条仍是 gate-cleared 二字段", async () => {
    const t = tracker();
    clock = 1000; await t.start("f1", "req");
    clock = 5000; await t.finish("f1", "verified", GATE);
    clock = 65_000; await t.clearGate("f1", { by: "human", via: "cockpit-merge", durationTier: "short" });
    const s = (await t.read("f1"))!;
    expect(s.gateLedger).toEqual([{
      gate: GATE.gate, what: GATE.what, openedAt: 5000, closedAt: 65_000, durationMs: 60_000,
      by: "human", via: "cockpit-merge", durationTier: "short", planGate: false,
    }]);
    expect(s.humanGate).toBeUndefined();
    expect(s.gateOpenedAt).toBeUndefined();
    expect(s.history.at(-1)).toEqual({ stage: "gate-cleared", at: 65_000 });
  });

  it("clearGate 不带署名 → by=unknown via=unattributed，且不写 durationTier 键", async () => {
    const t = tracker();
    clock = 1; await t.start("f1", "req");
    clock = 2; await t.finish("f1", "verified", GATE);
    clock = 3; await t.clearGate("f1");
    const entry = (await t.read("f1"))!.gateLedger![0]!;
    expect(entry.by).toBe("unknown");
    expect(entry.via).toBe("unattributed");
    expect("durationTier" in entry).toBe(false);
  });

  it("plan- 前缀的父流门 → planGate=true；两次清门账本追加两条", async () => {
    const t = tracker();
    clock = 1; await t.start("plan-abc-123", "方案集成");
    clock = 2; await t.finish("plan-abc-123", "verified", { gate: GATE.gate, what: "kp/plan-abc-123 → main" });
    clock = 9; await t.clearGate("plan-abc-123", { by: "machine", via: "autopilot-cli" });
    clock = 10; await t.finish("plan-abc-123", "verified", { gate: GATE.gate, what: "kp/plan-abc-123 → main" });
    clock = 30; await t.clearGate("plan-abc-123", { by: "human", via: "cli-merge" });
    const ledger = (await t.read("plan-abc-123"))!.gateLedger!;
    expect(ledger.map((e) => [e.planGate, e.by, e.durationMs])).toEqual([[true, "machine", 7], [true, "human", 20]]);
  });

  it("没有门时 clearGate 不写账本", async () => {
    const t = tracker();
    clock = 1; await t.start("f1", "req");
    clock = 2; await t.finish("f1", "verified");
    expect((await t.read("f1"))!.gateOpenedAt).toBeUndefined();
    clock = 3; await t.clearGate("f1", { by: "human", via: "telegram" });
    expect((await t.read("f1"))!.gateLedger).toBeUndefined();
  });

  it("markSensitive 新造门 → 设 gateOpenedAt；门已存在 → 不动", async () => {
    const t = tracker();
    clock = 1; await t.start("f1", "req");
    clock = 2; await t.finish("f1", "verified");
    clock = 7; await t.markSensitive("f1", [{ file: "src/server/auth.ts", label: "鉴权/授权" }]);
    expect((await t.read("f1"))!.gateOpenedAt).toBe(7);
    clock = 8; await t.markSensitive("f1", [{ file: "src/server/auth.ts", label: "鉴权/授权" }]);
    expect((await t.read("f1"))!.gateOpenedAt).toBe(7);
  });

  it("parseDurationTier 只认三个字面量", () => {
    expect(parseDurationTier("short")).toBe("short");
    expect(parseDurationTier("medium")).toBe("medium");
    expect(parseDurationTier("long")).toBe("long");
    expect(parseDurationTier("")).toBeUndefined();
    expect(parseDurationTier("huge")).toBeUndefined();
    expect(parseDurationTier(undefined)).toBeUndefined();
    expect(parseDurationTier(3)).toBeUndefined();
  });
});