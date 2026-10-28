import { describe, it, expect } from "vitest";
import { runLoopAutopilot, type LoopAutopilotDeps } from "../../src/loop/loop-autopilot.js";
import type { LoopDef } from "../../src/loop/types.js";

const loopFixture: LoopDef = { id: "L1", name: "L1", projectId: "p1", recipe: "test", goal: { target: 3 }, metric: { key: "m", label: "m", current: 0 }, levers: [], waves: [], createdAt: 0, updatedAt: 0 };

function baseDeps(over: Partial<LoopAutopilotDeps> = {}): LoopAutopilotDeps {
  return {
    loopId: "L1",
    maxWaves: 3,
    readLoop: async () => loopFixture,
    pickNext: () => ({ lever: "x", target: "t" }),
    setNext: async () => {},
    driveWave: async () => ({ gated: false, verified: true, metricDelta: 1 }),
    ...over,
  };
}

describe("loop autopilot 打断检查点", () => {
  it("onCheckpoint 返回 true 时第一波前就停，stopReason=stopped，零波", async () => {
    let drove = 0;
    const r = await runLoopAutopilot(baseDeps({
      onCheckpoint: async () => true,
      driveWave: async () => { drove++; return { gated: false, verified: true }; },
    }));
    expect(r.stopReason).toBe("stopped");
    expect(r.waves.length).toBe(0);
    expect(drove).toBe(0);
  });

  it("onCheckpoint 返回 false 时照常跑（不影响既有行为）", async () => {
    const r = await runLoopAutopilot(baseDeps({
      onCheckpoint: async () => false,
      pickNext: () => null, // 立即 no-next-step 收尾，仅证明没被 checkpoint 拦
    }));
    expect(r.stopReason).toBe("no-next-step");
  });

  it("不传 onCheckpoint 时行为不变", async () => {
    const r = await runLoopAutopilot(baseDeps({ pickNext: () => null }));
    expect(r.stopReason).toBe("no-next-step");
  });
});
