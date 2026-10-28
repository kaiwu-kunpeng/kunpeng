import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { renderMobileNav } from "../../src/server/ui/mobile-tabbar.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { buildArchitectureGraph } from "../../src/server/ui/views/architecture-graph.js";
import { attentionItemsFromSnapshots } from "../../src/server/routes/attention.js";
import { clientScript } from "../../src/server/ui/client.js";
import * as templates from "../../src/task/templates.js";
import { httpSource } from "../helpers/http-source.js";
import type { DashboardState } from "../../src/server/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const state = {
  running: [], blockers: [], humanGates: [], patrol: { pendingCount: 0 },
  code: {}, systemLight: "green", loops: [], playbooks: [], opsGates: [],
} as unknown as DashboardState;

describe("导航收敛(行为化)", () => {
  it("侧栏「更多」details 收纳低频项,主区高频项在 details 之前", () => {
    const sb = renderSidebar(state, "overview");
    expect(sb).toContain("nav-more");
    expect(sb).toContain("<details");
    expect(sb).toContain("summary");
    const moreBlock = sb.slice(sb.indexOf("<details"));
    for (const route of ["#/tasks", "#/register-project", "#/evolution", "#/architecture", "#/terminal", "#/switchboard", "#/settings"]) {
      expect(moreBlock, `更多块应含 ${route}`).toContain(route);
    }
    const mainBlock = sb.slice(0, sb.indexOf("<details"));
    for (const route of ["#/overview", "#/workbench", "#/inbox", "#/library", "#/loops"]) {
      expect(mainBlock, `主区应含 ${route}`).toContain(route);
    }
    expect(sb).toContain("对话");
  });

  it("active 在更多里时 details 真展开,不在时收合(真差分,非 includes(open) 恒真)", () => {
    const sbSettings = renderSidebar(state, "settings");
    expect(/^<details[^>]*\bopen\b/.test(sbSettings.slice(sbSettings.indexOf("<details")))).toBe(true);
    const sbOverview = renderSidebar(state, "overview");
    expect(/^<details[^>]*\bopen\b/.test(sbOverview.slice(sbOverview.indexOf("<details")))).toBe(false);
  });

  it("总览活动流带下钻条与实时会话挂点", () => {
    const ov = renderOverview(state);
    expect(ov).toContain("data-activity-drill");
    expect(ov).toContain("#/tasks");
    expect(ov).toContain("data-live-sessions");
  });
});

describe("等我徽标(行为化)", () => {
  it("attention 路由模块在位、导出可用,且注册进 http 路由拼装", () => {
    expect(existsSync(join(root, "src", "server", "routes", "attention.ts"))).toBe(true);
    expect(typeof attentionItemsFromSnapshots).toBe("function");
    expect(attentionItemsFromSnapshots([])).toEqual([]);
    expect(httpSource()).toContain("routes/attention.js");
  });

  it("侧栏与移动 TabBar 渲染输出带徽标挂点,client 轮询接线", () => {
    expect(renderSidebar(state, "overview")).toContain("data-kp-attn");
    expect(renderMobileNav(state, "overview")).toContain("data-kp-attn");
    expect(clientScript).toContain("/api/attention");
    expect(clientScript).toContain("visibilitychange");
  });
});

describe("任务台 IA 收口(行为化)", () => {
  it("侧栏无可点的 review-inbox 死链;别名路由与 #/inbox 渲染同一视图", () => {
    const sb = renderSidebar(state, "inbox");
    expect(/<a[^>]*href="#\/review-inbox"/.test(sb)).toBe(false);
    const inboxHtml = renderViewFragment(state, "#/inbox");
    expect(inboxHtml).toContain("待我处理");
    expect(renderViewFragment(state, "#/review-inbox")).toBe(inboxHtml);
    expect(renderViewFragment(state, "#/review-inbox")).not.toBe(renderViewFragment(state, "#/overview"));
  });

  it("templates 死导出已删、validateTaskDraft 保留(模块导出面)", () => {
    expect("taskTemplates" in templates).toBe(false);
    expect(typeof (templates as Record<string, unknown>).validateTaskDraft).toBe("function");
  });

  it("今日桶渲染验收标准(client 产物)", () => {
    expect(clientScript).toContain("acceptanceCriteria");
    expect(clientScript).toContain("验收:");
  });

  it("架构下钻:关键节点带 route,client 弹层用它渲染链接", () => {
    const graph = buildArchitectureGraph(state);
    const withRoute = (graph.nodes as Array<{ id: string; route?: string }>).filter((n) => typeof n.route === "string" && n.route.startsWith("#/"));
    expect(withRoute.length).toBeGreaterThanOrEqual(5);
    expect(clientScript).toContain("打开对应面板");
  });
});