import { describe, expect, it } from "vitest";
import { runAutopilot, type AutopilotDeps } from "../../src/loop/autopilot.js";

function harness(mode: "report" | "enforce", tier: "auto" | "human") {
  const flows = [{ flowId: "t1", status: "verified", humanGate: { gate: "合并主干 (人工门#1)", what: "kp/t1 → main" }, requirement: "普通改动" }];
  const calls: { setMergeTier: unknown[]; setGateHold: unknown[]; merged: string[]; log: string[] } = { setMergeTier: [], setGateHold: [], merged: [], log: [] };
  const deps: AutopilotDeps = {
    tracker: {
      list: async () => flows,
      markSensitive: async () => {},
      setMergeTier: async (flowId: string, rec: unknown) => { calls.setMergeTier.push([flowId, rec]); },
      setGateHold: async (flowId: string, hold: unknown) => { calls.setGateHold.push([flowId, hold]); },
    } as unknown as AutopilotDeps["tracker"],
    merge: async (flowId: string) => { calls.merged.push(flowId); return { ok: true }; },
    tier: async () => ({ tier, reasons: tier === "human" ? ["缺少先红证据"] : [], ruleIds: tier === "human" ? ["no-red-first-evidence"] : [], mode }),
    log: (line: string) => calls.log.push(line),
  };
  return { deps, calls };
}

describe("autopilot 分级表接线（作者锁定）", () => {
  it("report 模式 + human：写 mergeTier、打一行日志，但照旧合并", async () => {
    const { deps, calls } = harness("report", "human");
    const r = await runAutopilot(deps);
    expect(r.merged).toEqual(["t1"]);
    expect(calls.merged).toEqual(["t1"]);
    expect(calls.setMergeTier).toHaveLength(1);
    expect((calls.setMergeTier[0] as [string, { tier: string; mode: string; ruleIds: string[] }])[1]).toMatchObject({ tier: "human", mode: "report", ruleIds: ["no-red-first-evidence"] });
    expect(calls.setGateHold).toHaveLength(0);
    expect(calls.log.some((l) => l.includes("分级表") && l.includes("t1") && l.includes("tier=human"))).toBe(true);
  });

  it("enforce 模式 + human：不合并、skipped 理由含分级表、gateHold=tier-human", async () => {
    const { deps, calls } = harness("enforce", "human");
    const r = await runAutopilot(deps);
    expect(r.merged).toEqual([]);
    expect(calls.merged).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toContain("分级表判需人审");
    expect(r.skipped[0]!.reason).toContain("缺少先红证据");
    expect(calls.setGateHold).toHaveLength(1);
    expect((calls.setGateHold[0] as [string, { kind: string; reason: string }])[1]).toMatchObject({ kind: "tier-human" });
  });

  it("enforce 模式 + auto：正常合并，不留门", async () => {
    const { deps, calls } = harness("enforce", "auto");
    const r = await runAutopilot(deps);
    expect(r.merged).toEqual(["t1"]);
    expect(calls.setGateHold).toHaveLength(0);
    expect(calls.setMergeTier).toHaveLength(1);
  });

  it("tier 计算异常 → 保守 skipped，不合并", async () => {
    const { deps, calls } = harness("report", "auto");
    deps.tier = async () => { throw new Error("git 挂了"); };
    const r = await runAutopilot(deps);
    expect(calls.merged).toEqual([]);
    expect(r.skipped[0]!.reason).toContain("分级表计算异常");
  });

  it("没接 tier 依赖时行为不变（既有调用方）", async () => {
    const { deps, calls } = harness("report", "human");
    delete deps.tier;
    const r = await runAutopilot(deps);
    expect(r.merged).toEqual(["t1"]);
    expect(calls.setMergeTier).toHaveLength(0);
  });
});