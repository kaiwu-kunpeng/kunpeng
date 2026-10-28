import { describe, it, expect } from "vitest";
import { loopViewFrom } from "../../src/server/state.js";
import type { LoopDef } from "../../src/loop/types.js";

function def(waves: LoopDef["waves"]): LoopDef {
  return {
    id: "l1", name: "L1", projectId: "p1", recipe: "agent-playbook",
    metric: { key: "m", label: "M", current: 0 },
    levers: [], waves, createdAt: 1, updatedAt: 1,
  };
}

const wave = (seq: number, at: number) => ({
  seq, at, lever: "lv", subject: "s", metricDelta: 0, metricAfter: 0, verified: true,
});

describe("LoopView 填充最近一波(修到期判定恒真)", () => {
  it("有波次 → waves 恰含最近一条(按 seq 最大),带 at", () => {
    const view = loopViewFrom(def([wave(1, 1000), wave(3, 3000), wave(2, 2000)]), 5000);
    expect(view.waves).toBeDefined();
    expect(view.waves?.length).toBe(1);
    expect(view.waves?.[0]?.seq).toBe(3);
    expect(view.waves?.[0]?.at).toBe(3000);
    expect(view.waveCount).toBe(3);
  });

  it("零波次 → waves 为空数组,不是 undefined 语义破坏", () => {
    const view = loopViewFrom(def([]), 5000);
    expect(Array.isArray(view.waves)).toBe(true);
    expect(view.waves?.length).toBe(0);
  });

  it("recent 摘要不受影响,仍最多 5 条", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => wave(n, n * 1000));
    const view = loopViewFrom(def(many), 99999);
    expect(view.recent.length).toBe(5);
    expect(view.waves?.length).toBe(1);
    expect(view.waves?.[0]?.seq).toBe(7);
  });
});