import { describe, it, expect } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";
import { clientScript } from "../../src/server/ui/client.js";
import { renderArchitecture } from "../../src/server/ui/views/architecture.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import { renderTasks } from "../../src/server/ui/views/tasks.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";
import type { DashboardState } from "../../src/server/state.js";

const stateWith = (over: Record<string, unknown>): DashboardState =>
  ({ loops: [], playbooks: [], opsGates: [], ...over }) as unknown as DashboardState;

describe("主题产物行为化(替代 theme.ts 源码 grep)", () => {
  it("--arch-* token 日夜双定义", () => {
    for (const t of ["--arch-node-1", "--arch-node-7", "--arch-node-ink", "--arch-edge"]) {
      expect(themeCss.split(`${t}:`).length - 1, `${t} 应日夜各一次`).toBeGreaterThanOrEqual(2);
    }
  });
  it(".pc-title 用 var(--ink),全 CSS 无未定义 var(--text)", () => {
    expect(themeCss).toMatch(/\.pc-title\{[^}]*color:var\(--ink\)/);
    expect(themeCss).not.toContain("var(--text)");
  });
  it("project-wrap min() 自适应,不破坏 .wrap 1280 上限", () => {
    expect(themeCss).toMatch(/\.project-wrap\{[^}]*max-width:\s*min\(/);
    expect(themeCss).toContain(".wrap{max-width:1280px;margin:0 auto}");
  });
  it("tag-info/tb-card 横滚/ops-overview/kp-traj 类均有定义", () => {
    expect(themeCss).toContain("tag-info");
    expect(themeCss).toMatch(/\.tb-card\{[^}]*overflow-x:\s*auto/);
    expect(themeCss).toContain(".ops-overview{");
    expect(themeCss).toContain("kp-traj");
  });
  it("on-primary/on-warn token 且日夜双定义", () => {
    expect(themeCss).toContain("--on-warn");
    expect((themeCss.match(/--on-primary:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("client 产物行为化(替代 client-parts 源码 grep)", () => {
  it("渲染串可拼装且体量正常", () => {
    expect(clientScript.length).toBeGreaterThan(100000);
  });
  it("cytoscape 从 CSS 变量读色,旧 Tailwind 浅色清除", () => {
    expect(clientScript).toContain("--arch-node-1");
    expect(clientScript).toContain("getPropertyValue");
    for (const hex of ["#eff6ff", "#f5f3ff", "#cbd5e1"]) {
      expect(clientScript.includes(hex), `不应含 ${hex}`).toBe(false);
    }
  });
  it("详情弹层/状态色不再硬编码,hex 总量 ≤60", () => {
    for (const s of ['"#111827"', "#e5e7eb", "#d1d5db", "var(--line,"]) {
      expect(clientScript.includes(s), `不应含 ${s}`).toBe(false);
    }
    expect(clientScript).toContain("var(--card)");
    expect(clientScript).toContain("var(--info)");
    expect((clientScript.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length).toBeLessThanOrEqual(60);
  });
  it("队列徽章中文化,pill 光晕走 token,在跑 pill 不用 success 绿", () => {
    expect(clientScript).toContain("待认领");
    expect(clientScript).toContain("进行中");
    expect(clientScript).not.toContain("rgba(245,158,11,.2)");
    const zones = clientScript.split("在跑").slice(1);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.slice(0, 200).includes("--success"), "在跑 pill 200 字符内不应引 --success").toBe(false);
    }
    expect(clientScript).toContain("kp-traj");
  });
});

describe("视图渲染行为化(替代视图源码 grep)", () => {
  it("架构图图例引 var(--arch-node-,渲染输出零硬编码 hex", () => {
    const html = renderArchitecture(stateWith({}));
    expect(html).toContain("var(--arch-node-");
    expect((html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length).toBe(0);
  });
  it("loops 空态渲染带引号 ops-overview 类,无滞字实体", () => {
    const html = renderLoops(stateWith({}));
    expect(html).toContain('class="ops-overview"');
    expect(html).not.toContain("&#28382;");
  });
  it("running 流渲染走 tag-info 而非默认 warn,无喂断言假属性", () => {
    const html = renderTasks([{ id: "b", requirement: "短二", status: "running", history: [] }]);
    expect(html).toContain("tag-info");
    expect(html).not.toContain("tag-warn");
    expect(html).not.toContain("data-status-fallback-class");
  });
  it("workbench 面板白字走 on-primary token,网格与高度修复在产出中", () => {
    const html = renderWorkbenchPanel("SUMMARY");
    expect(html).toContain("var(--on-primary)");
    expect(html).toContain("min(540px");
    expect(html).toContain("calc(100vh - 214px)");
  });
});