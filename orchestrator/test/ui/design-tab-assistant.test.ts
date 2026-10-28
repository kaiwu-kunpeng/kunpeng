import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderProject } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
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
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: [],
    code: {
      srcLines: 0,
      testLines: 0,
      passedLines: 0,
      inFlightLines: 0,
      completed: 0,
      running: 0,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  };
}

describe("design tab assistant", () => {
  test("renders assistant controls and empty-state design candidate hint", () => {
    const html = renderProject(fixture(), "kunpeng", "design");

    expect(html).toContain('data-panel="design-workflow"');
    expect(html).toContain('data-panel="design-advise"');
    expect(html).toContain("设计助手");
    expect(html).toContain('data-action="design-advise"');
    expect(html).toContain("data-design-brief");
    expect(html).toContain("暂无设计候选");
  });

  test("merges advise, loop, and generate controls into one visual step card", () => {
    const html = renderProject(fixture(), "kunpeng", "design");

    expect(html.match(/data-panel="design-workflow"/g)).toHaveLength(1);
    expect(html).not.toContain('class="sub-h"');
    expect(html).toMatch(/data-panel="design-workflow"[\s\S]*设计助手 · 一句话快速建议[\s\S]*设计 Loop · 完整方案[\s\S]*生成页面/);
    expect(html).toContain('data-action="design-generate"');
  });

  test("keeps assistant and existing candidate area when candidates exist", () => {
    const html = renderProject(fixture({
      designCandidates: [{ index: 0, source: "house", anchor: "a1", png: "" }],
    }), "kunpeng", "design");

    expect(html).toContain("设计助手");
    expect(html).toContain("设计候选");
    expect(html).toContain('data-design-candidate="house"');
    expect(html).toContain('data-action="select-design"');
  });

  test("client script contains design advise handler and endpoint wiring", () => {
    expect(clientScript).toContain('action === "design-advise"');
    expect(clientScript).toContain("/api/design-advise");
    expect(clientScript).toContain("design-advise-out");
    expect(() => new Function(clientScript)).not.toThrow();
  });
});
