import { describe, expect, test } from "vitest";
import { renderProject } from "../../src/server/ui/views/project.js";
import type { DashboardState, FlowWithLight } from "../../src/server/state.js";

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

function runningFlow(overrides: Partial<FlowWithLight> = {}): FlowWithLight {
  return {
    flowId: "f1",
    requirement: "做A",
    stage: "implement",
    status: "running",
    agentActive: false,
    startedAt: 1,
    updatedAt: 1,
    history: [],
    light: "green",
    ...overrides,
  };
}

describe("renderProject", () => {
  test("renders design candidates with selected state and design tab active", () => {
    const html = renderProject(fixture({
      designCandidates: [
        { index: 0, source: "house", anchor: "a1", png: "" },
        { index: 1, source: "agent", anchor: "a2", png: "" },
      ],
      designSelected: "house",
    }), "kunpeng", "design");

    expect(html.match(/data-design-candidate=/g)).toHaveLength(2);
    expect(html).toContain("house");
    expect(html).toContain("a1");
    expect(html).toContain("agent");
    expect(html).toContain("a2");
    expect(html).toContain("✅ 已选");
    expect(html).toContain("生成设计代码");
    expect(html).toContain('data-action="design-codegen"');
    expect(html).toContain("选这套");
    expect(html).toContain('data-action="select-design"');
    expect(html).toContain('data-source="agent"');
    expect(html).toContain('data-anchor="a2"');
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/design">设计/);
  });

  test("renders plans tab without design candidate actions", () => {
    const html = renderProject(fixture({
      plans: [{ id: "p1", status: "verified", merged: true, desc: "方案X", summary: "做了X的事", segmentCount: 2 }],
      designCandidates: [{ index: 0, source: "house", anchor: "a1", png: "" }],
    }), "kunpeng", "plans");

    expect(html).toContain("方案X");
    // 已合并方案徽标显示「已合并」（不再显示 verified 原始状态——卡片化后的预期）。
    expect(html).toContain("已合并");
    expect(html).toContain("做了X的事");
    expect(html).toContain("2 段");
    expect(html).toContain("起方案");
    expect(html).toContain('data-action="plan"');
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/plans">方案/);
    expect(html).not.toContain('data-action="select-design"');
    expect(html).not.toContain('data-action="design-codegen"');
  });

  test("renders flows tab with running flow and log action", () => {
    const html = renderProject(fixture({
      running: [runningFlow()],
      flows: [],
    }), "kunpeng", "flows");

    expect(html).toContain("做A");
    expect(html).toContain("implement");
    expect(html).toContain('data-action="flow-log"');
    expect(html).toContain('data-flow="f1"');
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/flows">开发流/);
  });

  test("renders project header with project name and run action", () => {
    const html = renderProject(fixture(), "project-id", "design", { projectName: "kunpeng" });

    expect(html).toContain("kunpeng");
    expect(html).toContain("启动新工作");
    expect(html).toContain('data-action="run"');
  });

  test("falls back unknown tab to overview", () => {
    const html = renderProject(fixture({
      designCandidates: [{ index: 0, source: "house", anchor: "a1", png: "" }],
    }), "kunpeng", "unknown");

    expect(html).toContain("项目概览");
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/overview">概览/);
    expect(html).not.toContain("选这套");
  });
});
