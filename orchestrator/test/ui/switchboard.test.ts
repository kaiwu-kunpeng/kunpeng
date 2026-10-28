import { describe, expect, test } from "vitest";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { clientScript } from "../../src/server/ui/client.js";
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

describe("通讯视图", () => {
  test("#/switchboard 路由渲染四个面板容器", () => {
    const html = renderViewFragment(fixture(), "#/switchboard");
    expect(html).toContain("通讯");
    expect(html).toContain('id="sb-escalations"');
    expect(html).toContain('id="sb-presence"');
    expect(html).toContain('id="sb-inbox"');
    expect(html).toContain('data-action="sb-send"');
    expect(html).toContain("data-sb-to");
    expect(html).toContain("data-sb-urgent");
  });

  test("侧栏含通讯入口", () => {
    const html = renderSidebar(fixture(), "switchboard");
    expect(html).toContain('href="#/switchboard"');
    expect(html).toContain("通讯");
    // 当前路由为 switchboard 时应高亮
    expect(html).toMatch(/class="nav-item active" href="#\/switchboard"/);
  });

  test("client 接线:轮询拉取 + 发送 + 升级告警", () => {
    expect(clientScript).toContain("switchboardLoad");
    expect(clientScript).toContain("/api/switchboard/escalations");
    expect(clientScript).toContain("/api/switchboard/presence");
    expect(clientScript).toContain("/api/switchboard/inbox?as=");
    expect(clientScript).toContain("/api/switchboard/send");
    expect(clientScript).toContain('"#/switchboard"');
    // 救命优先:升级队列非空时给红色告警条
    expect(clientScript).toContain("sb-alert");
  });
});
