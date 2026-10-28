import { describe, expect, it } from "vitest";
import { autoMergeVerdict, runAutopilot } from "../src/loop/autopilot.js";

function fakeTracker(flows: unknown[]) {
  return { list: async () => flows, markSensitive: async () => {} } as never;
}

describe("分级自动合并(作者验收)", () => {
  it("普通需求自动合,敏感需求留人工", () => {
    expect(autoMergeVerdict(["orchestrator/src/metrics/x.ts"]).auto).toBe(true);
    expect(autoMergeVerdict(["constitution/core.md"]).auto).toBe(false);
    expect(autoMergeVerdict([".kunpeng/hooks.json"]).auto).toBe(false);
    expect(autoMergeVerdict(["orchestrator/src/agent/CredentialVault.ts"]).auto).toBe(false);
  });

  it("guardian 来源的普通流现在会被自动合并", async () => {
    const flows = [
      { flowId: "g1", status: "verified", humanGate: { gate: "合并主干", what: "kp/x → main" }, requirement: "[guardian-reinject] 修复 escapeHtml 重复定义" },
    ];
    const merged: string[] = [];
    const r = await runAutopilot({
      tracker: fakeTracker(flows),
      merge: async (flowId: string) => { merged.push(flowId); return { ok: true }; },
    });
    expect(merged).toContain("g1");
    expect(r.merged).toContain("g1");
  });

  it("敏感流被 skip 且理由说明需人工", async () => {
    const flows = [
      { flowId: "s1", status: "verified", humanGate: { gate: "合并主干", what: "kp/y → main" }, requirement: "修改 constitution 增加新军规" },
    ];
    const r = await runAutopilot({
      tracker: fakeTracker(flows),
      merge: async () => ({ ok: true }),
      sensitive: async () => ({ hits: [{ file: "constitution/core.md", label: "宪法与角色卡" }] }),
    });
    expect(r.merged.length).toBe(0);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0].reason).toContain("人工");
  });
});