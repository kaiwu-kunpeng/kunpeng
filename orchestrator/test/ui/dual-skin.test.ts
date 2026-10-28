import { describe, expect, test } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderShell } from "../../src/server/ui/shell.js";
import type { DashboardState } from "../../src/server/state.js";

function fixture(): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
    branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
  };
}

describe("cockpit 双皮肤", () => {
  test("theme.ts 同时定义 :root(日) 与 html[data-theme=dark](夜) 的 8 个核心 token", () => {
    expect(themeCss).toContain(":root{");
    expect(themeCss).toContain('html[data-theme="dark"]{');
    // 日皮核心 token 仍在 :root
    for (const t of ["--bg", "--card", "--ink", "--primary", "--warn", "--success", "--danger", "--line"]) {
      expect(themeCss).toContain(`${t}:`);
    }
    // 夜皮覆盖了渊蓝黑值（AgentsRoom）
    const dark = themeCss.slice(themeCss.indexOf('html[data-theme="dark"]'));
    expect(dark).toContain("--bg:#0B1220");
    expect(dark).toContain("--card:#111A2C");
    expect(dark).toContain("--ink:#E6EDF6");
    expect(dark).toContain("--primary:#22B8D4");
  });

  test("不再有会破坏夜皮的关键硬编码色（muted 标签/track 条已 var 化）", () => {
    expect(themeCss).not.toContain("color:#94A3B8");
    expect(themeCss).not.toContain("background:#e5e7eb");
  });

  test("shell 渲染含 ☀️/🌙 皮肤切换控件，挂主线 client.ts 的 data-theme-set 机制", () => {
    const html = renderShell(fixture(), { projects: [{ id: "kunpeng", name: "kunpeng" }] });
    expect(html).toContain('class="theme-toggle"');
    expect(html).toContain('data-theme-set="light"');
    expect(html).toContain('data-theme-set="dark"');
  });

  test("切换控件高亮态由 html[data-theme] 纯 CSS 驱动（不依赖 JS .on 同步）", () => {
    expect(themeCss).toContain('html[data-theme="dark"] .theme-toggle button[data-theme-set="dark"]');
  });
});
