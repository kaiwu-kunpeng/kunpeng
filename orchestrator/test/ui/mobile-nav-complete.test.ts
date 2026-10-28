import { describe, expect, it } from "vitest";

import type { DashboardState } from "../../src/server/state.js";
import { part07 } from "../../src/server/ui/client-parts/part07.js";
import { renderMobileNav } from "../../src/server/ui/mobile-tabbar.js";

const state = {
  running: [], blockers: [], humanGates: [], patrol: { pendingCount: 0 },
  code: {}, systemLight: "green", loops: [], playbooks: [], opsGates: [],
} as unknown as DashboardState;

describe("手机导航补全", () => {
  it("更多面板含全局搜索按钮(data-kp-palette)", () => {
    const html = renderMobileNav(state, "overview");
    expect(html).toContain("data-kp-palette");
    expect(html).toContain("搜索");
  });

  it("此前手机不可达的页面全部有入口", () => {
    const html = renderMobileNav(state, "overview");
    for (const href of ["#/tasks", "#/insights", "#/library", "#/solutions", "#/skills", "#/docs", "#/register-project", "/plugins", "/help"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("原有主 tab 与更多项保留", () => {
    const html = renderMobileNav(state, "overview");
    for (const href of ["#/overview", "#/inbox", "#/workbench", "#/terminal", "#/loops", "#/settings"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("part07 有 data-kp-palette 委托点击并调 togglePalette", () => {
    expect(part07).toContain('closest("[data-kp-palette]")');
    expect(part07).toContain("togglePalette()");
  });
});
