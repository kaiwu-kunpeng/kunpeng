import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
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

function expectBanner(html: string, href: "#/overview" | "#/inbox", text: string): void {
  expect(html).toContain(`<a class="run" href="${href}">`);
  expect(html).toContain("今日下一步");
  expect(html).toContain(text);
}

describe("workbench next step banner", () => {
  test("prioritizes blockers and alerts over review items", () => {
    const html = renderWorkbench(fixture({
      blockers: [{ flowId: "f", stage: "verify", reason: "x" }],
      reviewQueue: [
        { projectId: "p", projectName: "P", kind: "release", id: "r1", title: "发布", detail: "d" },
      ],
    }));

    expectBanner(html, "#/overview", "卡住/告警");
  });

  test("prioritizes release review queue items", () => {
    const html = renderWorkbench(fixture({
      reviewQueue: [
        { projectId: "p", projectName: "P", kind: "release", id: "r1", title: "发布", detail: "d" },
        { projectId: "p", projectName: "P", kind: "merge", id: "m1", title: "合并", detail: "d" },
      ],
    }));

    expectBanner(html, "#/inbox", "确认发布");
  });

  test("falls back to release draft artifacts when reviewQueue is absent", () => {
    const html = renderWorkbench(fixture({
      artifacts: {
        release: [{ id: "rel-1", kind: "release", status: "draft", summary: "build ok" }],
      },
    }));

    expectBanner(html, "#/inbox", "确认发布");
  });

  test("prioritizes connector review items before proposals and merges", () => {
    const html = renderWorkbench(fixture({
      reviewQueue: [
        { projectId: "p", projectName: "P", kind: "merge", id: "m1", title: "合并", detail: "d" },
        { projectId: "p", projectName: "P", kind: "proposal", id: "prop-1", title: "提案", detail: "d" },
        { projectId: "p", projectName: "P", kind: "connector", id: "conn-1", title: "放行", detail: "d" },
      ],
    }));

    expectBanner(html, "#/inbox", "高风险动作待放行");
  });

  test("prioritizes proposal gates before merge gates", () => {
    const html = renderWorkbench(fixture({
      humanGates: [
        { what: "合并主干 kp/x -> main", detail: "d", flowId: "merge-1" },
        { what: "批准进化提案 (人工门#2)", detail: "prop-1", flowId: "prop-1" },
      ],
    }));

    expectBanner(html, "#/inbox", "自进化提案待审");
  });

  test("renders merge next step when only merge gates exist", () => {
    const html = renderWorkbench(fixture({
      humanGates: [{ what: "合并主干 kp/x -> main", detail: "d", flowId: "merge-1" }],
    }));

    expectBanner(html, "#/inbox", "待合并");
    expect(html).toContain("自动驾驶");
  });

  test("renders running next step before idle", () => {
    const html = renderWorkbench(fixture({
      running: [{
        flowId: "f1",
        requirement: "做事",
        stage: "implement",
        status: "running",
        agentActive: true,
        light: "green",
        startedAt: 0,
        updatedAt: 0,
        history: [],
      }],
    }));

    expectBanner(html, "#/overview", "流在跑");
  });

  test("renders idle next step when there is no work", () => {
    const html = renderWorkbench(fixture());

    expectBanner(html, "#/overview", "一切就绪");
  });

  test("renderViewFragment dispatch keeps the workbench banner", () => {
    const html = renderViewFragment(fixture(), "#/workbench");

    expect(html).toContain("现在需要我做什么");
    expectBanner(html, "#/overview", "一切就绪");
  });
});
