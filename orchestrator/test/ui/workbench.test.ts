import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { renderWorkbench } from "../../src/server/ui/views/workbench.js";

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

function fullState(): DashboardState {
  return fixture({
    running: [{
      flowId: "f1",
      requirement: "接线工作台",
      stage: "implement",
      status: "running",
      agentActive: true,
      light: "green",
      startedAt: 0,
      updatedAt: 0,
      history: [],
    }],
    blockers: [{ flowId: "f2", stage: "verify", reason: "测试失败" }],
    humanGates: [{ what: "合并主干 kp/x -> main", detail: "d", flowId: "f3" }],
    artifacts: {
      release: [{ id: "release-a", kind: "release", status: "draft", summary: "build ok" }],
      connector: [{ id: "conn-a", kind: "connector", status: "draft", summary: "退款动作" }],
      experience: [{ id: "exp-1", kind: "experience", status: "verified", summary: "经验一则" }],
    },
    health: { alerts: [{ flowId: "fx", kind: "long-running", ageMs: 1_800_000, stage: "implement" }], running: 1, healthy: 1 },
    evolution: {
      lastRunText: "x",
      pendingCount: 1,
      regression: { holdout: 1, optimization: 0 },
      approvedCount: 0,
      proposals: [{ id: "prop-1", status: "draft", summary: "提案一", hasEvidence: true, holdoutPassK: 0.8 }],
    },
  });
}

describe("renderWorkbench", () => {
  test("renders prioritized cross-project workbench signals", () => {
    const html = renderWorkbench(fullState());

    expect(html).toContain("现在需要我做什么");
    expect(html).toMatch(/<div class="n">1<\/div>\s*<div class="l">正在跑<\/div>/);
    expect(html).toMatch(/<div class="n">2<\/div>\s*<div class="l">失败\/卡住<\/div>/);
    expect(html).toMatch(/<div class="n">3<\/div>\s*<div class="l">等人审<\/div>/);
    expect(html).toMatch(/<div class="n">1<\/div>\s*<div class="l">可发布<\/div>/);
    expect(html).toContain('href="#/inbox"');
    expect(html).toContain('href="#/overview"');
    expect(html).toContain("合并主干");
    expect(html).toContain("f1");
    expect(html).toContain("测试失败");
    expect(html).toContain("长跑");
    expect(html).toContain("经验一则");
    expect(html).toContain("提案一");
    expect(html).toContain("证据");
  });

  test("uses reviewQueue for review KPIs and decision list when present", () => {
    const html = renderWorkbench(fixture({
      humanGates: [],
      artifacts: {},
      reviewQueue: [
        { projectId: "proj-a", projectName: "A 项目", kind: "merge", id: "f1", title: "合并主干", detail: "d" },
        { projectId: "proj-b", projectName: "B 项目", kind: "release", id: "rel-b", title: "发布 B", detail: "build ok" },
        { projectId: "proj-c", projectName: "C 项目", kind: "connector", id: "conn-c", title: "放行 C", detail: "退款" },
      ],
    }));

    expect(html).toMatch(/<div class="n">3<\/div>\s*<div class="l">等人审<\/div>/);
    expect(html).toMatch(/<div class="n">1<\/div>\s*<div class="l">可发布<\/div>/);
    expect(html).toContain("需要我决策");
    expect(html).toContain("A 项目");
    expect(html).toContain("B 项目");
    expect(html).toContain("C 项目");
    expect(html).toContain('<span class="tag">release</span>');
    expect(html).toContain("发布 B");
    expect(html).toContain('href="#/inbox"');
  });

  test("renders empty states without throwing", () => {
    const html = renderWorkbench(fixture({ evolution: undefined, artifacts: {} }));

    expect(html).toContain("暂无待决策");
    expect(html).toContain("当前没有运行中的流");
    expect(html).toContain("无告警");
    expect(html).toContain("暂无最近产出");
  });

  test("renderViewFragment dispatches workbench before falling back", () => {
    const html = renderViewFragment(fullState(), "#/workbench");

    expect(html).toContain("现在需要我做什么");
    expect(html).not.toContain("四类人审");
  });

  test("sidebar 对话(原工作台)链接激活,不再伪造工作台字样", () => {
    const html = renderSidebar(fullState(), "workbench");

    expect(html).toContain('href="#/workbench"');
    expect(html).toMatch(/class="nav-item active"[\s\S]*?href="#\/workbench"[\s\S]*?<span class="lbl">对话<\/span>/);
    expect(html).not.toContain("工作台");
  });
});