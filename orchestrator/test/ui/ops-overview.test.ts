import { describe, it, expect } from "vitest";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import type { DashboardState } from "../../src/server/state.js";

const DAY = 86_400_000;

function stateWith(over: Record<string, unknown>): DashboardState {
  return { loops: [], playbooks: [], opsGates: [], ...over } as unknown as DashboardState;
}

describe("运营总览条", () => {
  it("空态也渲染四个胶囊", () => {
    const html = renderLoops(stateWith({}));
    expect(html).toContain("ops-overview");
    expect(html).toContain("到期该跑 0");
    expect(html).toContain("待裁决门 0");
    expect(html).toContain("停滞 loop 0");
    expect(html).toContain("顽固卡点 0");
  });

  it("到期/待裁决/停滞/顽固全部计数正确", () => {
    const now = Date.now();
    const html = renderLoops(stateWith({
      playbooks: [{ id: "pb1", title: "T", loopId: "l1", cadence: "daily" }],
      opsGates: [
        { id: "g1", projectId: "p", playbookId: "pb1", loopId: "l1", reason: "r", status: "pending", createdAt: 1 },
        { id: "g2", projectId: "p", playbookId: "pb1", loopId: "l1", reason: "r", status: "approved", createdAt: 1 },
      ],
      loops: [{
        id: "l1",
        projectId: "p",
        name: "L1",
        metric: { label: "M", current: 1 },
        waveCount: 2,
        recent: [],
        leversByStatus: { active: [], needsDev: [], honestZero: [] },
        gotchas: [],
        summary: "",
        waves: [
          { seq: 1, at: now - 20 * DAY, verified: true, metricDelta: 1, metricAfter: 1, lever: "x", subject: "a", gotchas: ["反爬"] },
          { seq: 2, at: now - 16 * DAY, verified: true, metricDelta: 0, metricAfter: 1, lever: "x", subject: "b", gotchas: ["反爬"] },
        ],
      }],
    }));
    expect(html).toContain("到期该跑 1");
    expect(html).toContain("待裁决门 1");
    expect(html).toContain("停滞 loop 1");
    expect(html).toContain("顽固卡点 1");
  });
});