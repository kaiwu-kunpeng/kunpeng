import { describe, it, expect } from "vitest";
import { renderShell } from "../../src/server/ui/shell.js";
import { clientScript } from "../../src/server/ui/client.js";
import type { DashboardState } from "../../src/server/state.js";

const state: DashboardState = {
  agents: 1, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
  branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
  patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
  code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
  designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
};

describe("workspace switcher", () => {
  it("shell 渲染切换器 + 全部工作区 + 每个工作区选项", () => {
    const html = renderShell(state, { projects: [{ id: "kunpeng", name: "鲲鹏" }, { id: "acme-shop", name: "配件超市" }] });
    expect(html).toContain('id="kp-workspace-switcher"');
    expect(html).toContain("全部工作区");
    expect(html).toContain("鲲鹏");
    expect(html).toContain("配件超市");
    expect(html).toContain('value="#/overview"');
    expect(html).toContain('value="#/project/acme-shop"');
  });
  it("无项目→只有全部工作区一项", () => {
    const html = renderShell(state, { projects: [] });
    expect(html).toContain('id="kp-workspace-switcher"');
    expect(html).toContain("全部工作区");
  });
  it("client 接了切换器 change 事件", () => {
    expect(clientScript).toContain("kp-workspace-switcher");
    expect(clientScript).toContain("change");
  });
});
