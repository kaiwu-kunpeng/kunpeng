import { describe, it, expect } from "vitest";
import { runAutopilot } from "../src/loop/autopilot.js";
import type { FlowState, FlowTracker } from "../src/runtime/flowstate.js";

function vflow(flowId: string): FlowState {
  return {
    flowId,
    requirement: "feat " + flowId,
    stage: "done",
    status: "verified",
    agentActive: false,
    humanGate: { gate: "合并主干 (人工门#1)", what: "kp/" + flowId + " → main" },
    startedAt: 1,
    updatedAt: 2,
    history: [],
  } as FlowState;
}

describe("autopilot 自动驳回过不去的门", () => {
  it("futile 门被 discard 计入 rejected、不 merge；可过门照常 merge", async () => {
    const flows = [vflow("empty-one"), vflow("real-one")];
    const tracker = { list: async () => flows } as unknown as FlowTracker;
    const discarded: string[] = [];
    const merged: string[] = [];
    const result = await runAutopilot({
      tracker,
      merge: async (flowId) => { merged.push(flowId); return { ok: true }; },
      futile: async (flowId) => flowId === "empty-one" ? { futile: true, reason: "空提交" } : { futile: false },
      discard: async (flowId) => { discarded.push(flowId); },
    });
    expect(discarded).toEqual(["empty-one"]);
    expect(result.rejected.map((r) => r.flowId)).toEqual(["empty-one"]);
    expect(result.merged).toEqual(["real-one"]);
    expect(merged).toEqual(["real-one"]);
  });

  it("不注入 futile/discard 时行为不变（无 rejected）", async () => {
    const flows = [vflow("a")];
    const tracker = { list: async () => flows } as unknown as FlowTracker;
    const result = await runAutopilot({
      tracker,
      merge: async () => ({ ok: true }),
    });
    expect(result.rejected).toEqual([]);
    expect(result.merged).toEqual(["a"]);
  });

  it("futile 检测抛错 → 保守保留门（进 skipped，不 discard）", async () => {
    const flows = [vflow("boom")];
    const tracker = { list: async () => flows } as unknown as FlowTracker;
    const discarded: string[] = [];
    const result = await runAutopilot({
      tracker,
      merge: async () => ({ ok: true }),
      futile: async () => { throw new Error("git 挂了"); },
      discard: async (flowId) => { discarded.push(flowId); },
    });
    expect(discarded).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.skipped.map((s) => s.flowId)).toEqual(["boom"]);
  });
});
