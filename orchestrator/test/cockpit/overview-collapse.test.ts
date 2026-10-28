import { describe, it, expect } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState } from "../../src/server/state.js";

// 最小可渲染 state:字段尽量给空/零,验证折叠结构存在且 panel 内容仍在 DOM。
const state = {
  agents: 0,
  flows: [],
  running: [],
  blockers: [],
  humanGates: [],
  artifacts: {},
  branches: [],
  statusCounts: {},
  systemLight: "green",
  agentAssignments: [],
  patrol: { pendingCount: 0, lastRunText: "" },
  plans: [],
  code: { srcLines: 0, testLines: 0, passedLines: 0, completed: 0 },
  designCandidates: [],
  health: { alerts: [] },
} as unknown as DashboardState;

describe("总览折叠运维指标", () => {
  it("渲染含 details.more-metrics 折叠容器与 summary", () => {
    const html = renderOverview(state);
    expect(html).toContain('<details class="more-metrics">');
    expect(html).toContain("<summary>");
    expect(html).toContain("运维指标与历史");
  });

  it("待我处理/战略/在跑什么 仍在 details 之外、之上", () => {
    const html = renderOverview(state);
    const detailsIdx = html.indexOf('<details class="more-metrics">');
    expect(detailsIdx).toBeGreaterThan(-1);
    // 「在跑什么」section 在 details 之前出现(领头区不被折叠)
    expect(html.indexOf("在跑什么")).toBeLessThan(detailsIdx);
  });
});