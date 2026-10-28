import { describe, it, expect } from "vitest";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import type { DashboardState } from "../../src/server/state.js";

const DAY = 86_400_000;

function stateWith(waves: Array<{ at: number; verified: boolean; metricDelta: number; metricAfter: number; seq: number; lever: string; subject: string; gotchas?: string[] }>): DashboardState {
  return {
    loops: [{
      id: "l1",
      projectId: "p1",
      name: "测试 loop",
      metric: { label: "PWQ", current: 10 },
      waveCount: waves.length,
      recent: [],
      leversByStatus: { active: [], needsDev: [], honestZero: [] },
      gotchas: [],
      summary: "",
      waves,
    }],
  } as unknown as DashboardState;
}

describe("loops 页运营度量块", () => {
  it("活跃 loop：30天波次/验证率上屏，顽固卡点标出", () => {
    const now = Date.now();
    const html = renderLoops(stateWith([
      { seq: 1, at: now - 3 * DAY, verified: true, metricDelta: 5, metricAfter: 15, lever: "model-expand", subject: "A", gotchas: ["反爬"] },
      { seq: 2, at: now - 1 * DAY, verified: true, metricDelta: 2, metricAfter: 17, lever: "model-expand", subject: "B", gotchas: ["反爬"] },
    ]));
    expect(html).toContain("ops-metrics");
    expect(html).toContain("30天 2 波");
    expect(html).toContain("验证率 100%");
    expect(html).toContain("ops-recurring");
    expect(html).toContain("顽固×2");
    expect(html).toContain("反爬");
    expect(html.includes("停滞&gt;14天")).toBe(false);
  });

  it("停滞 loop 出警示，无顽固卡点不出块", () => {
    const now = Date.now();
    const html = renderLoops(stateWith([
      { seq: 1, at: now - 20 * DAY, verified: true, metricDelta: 5, metricAfter: 15, lever: "model-expand", subject: "A" },
    ]));
    expect(html).toContain("停滞");
    expect(html.includes("ops-recurring")).toBe(false);
  });
});
