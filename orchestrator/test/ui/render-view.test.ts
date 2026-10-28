import { describe, expect, test } from "vitest";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
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

describe("renderViewFragment", () => {
  test("renders overview for overview route", () => {
    expect(renderViewFragment(fixture(), "#/overview")).toContain("在跑什么");
  });

  test("renders inbox for inbox route", () => {
    // 用 inbox 独有串「控制门」判别：overview 也含「待我处理」(KPI 标签)，不能用来区分 inbox/overview。
    const html = renderViewFragment(fixture(), "#/inbox");
    expect(html).toContain("控制门");
    expect(html).not.toContain("在跑什么");
  });

  test("renders project design tab for project sub-route", () => {
    const html = renderViewFragment(
      fixture({ designCandidates: [{ index: 0, source: "house", anchor: "a1", png: "" }] }),
      "#/project/kunpeng/design",
      { projectName: "kunpeng" },
    );

    expect(html).toContain("kunpeng");
    expect(html).toContain("选这套");
    expect(html).toContain("house");
    expect(html).toContain("a1");
    expect(html).not.toContain("阶段③");
  });

  test("renders project plans tab for project sub-route", () => {
    const html = renderViewFragment(
      fixture({ plans: [{ id: "p1", status: "verified", merged: false, desc: "方案X", summary: "方案X", segmentCount: 1 }] }),
      "#/project/kunpeng/plans",
      { projectName: "kunpeng" },
    );

    expect(html).toContain("起方案");
    expect(html).toContain("方案X");
    expect(html).not.toContain('data-action="select-design"');
    expect(html).not.toContain("阶段③");
  });

  test("defaults project route without tab to overview tab", () => {
    const html = renderViewFragment(
      fixture({ designCandidates: [{ index: 0, source: "house", anchor: "a1", png: "" }] }),
      "#/project/kunpeng",
      { projectName: "kunpeng" },
    );

    expect(html).toContain("项目概览");
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/overview">概览/);
    expect(html).not.toContain("选这套");
  });

  test("falls back to overview for unknown route", () => {
    expect(renderViewFragment(fixture(), "#/zzz")).toContain("在跑什么");
  });
});
