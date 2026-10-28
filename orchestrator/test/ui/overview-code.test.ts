import { expect, test } from "vitest";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import type { DashboardState } from "../../src/server/state.js";

// 首页下钻「全部工作区代码」面板：state.code 是跨项目聚合，标签必须如实；数字来源不变。
function stateWithCode(): DashboardState {
  return {
    agents: 1, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
    branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 9000, testLines: 10000, passedLines: 19000, inFlightLines: 120, completed: 34, running: 1, rolledBack: 2 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    activity: { total: 0, verified: 0, rolledBack: 0, successRate: 1, recent: [] },
  };
}

test("总览渲染「全部工作区代码」面板，含过审行数与 src/test 行数", () => {
  const html = renderOverview(stateWithCode());
  expect(html).toContain('data-panel="code"');
  expect(html).toContain("9000");   // 源码
  expect(html).toContain("10000");  // 测试
  expect(html).toContain("19000");  // 已过审
  expect(html).toContain("34");     // 已交付方案
  expect(html).toContain("全部工作区代码");
  expect(html).toContain("跨项目求和 · 已过审入 main");
});

test("下钻面板不再自称鲲鹏本体；顶部本体专列行照旧", () => {
  const html = renderOverview(stateWithCode());
  expect(html).not.toContain("鲲鹏本体代码");
  expect(html).toContain("鲲鹏本体 19000 行代码");
});