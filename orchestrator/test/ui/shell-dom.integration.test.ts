// @vitest-environment happy-dom
//
// 真实 DOM 集成测试：渲染 shell → 在 happy-dom 里执行 clientScript → 模拟 hash 路由，
// 验证「侧栏导航 active 迁移」+「fetch 片段注入（renderView）真把对的视图换进 #view」。
// 关键：fetch stub 返回**判别性 sentinel**（OV_FETCH / INBOX_FETCH），它们不出现在服务端
// 首屏 renderOverview 里——所以一旦 client 不注入/注错路由，断言必红（堵 wiring 盲区；
// 对抗审查发现旧断言用「待我处理/在跑什么」无区分度，overview 自身就含这俩，故空壳）。
import { describe, expect, test, beforeEach, vi } from "vitest";
import { renderShell } from "../../src/server/ui/shell.js";
import type { DashboardState } from "../../src/server/state.js";

const state: DashboardState = {
  agents: 1,
  flows: [],
  running: [],
  blockers: [],
  humanGates: [],
  artifacts: {},
  branches: ["kp/x"],
  statusCounts: {},
  systemLight: "green",
  agentAssignments: [],
  patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
  plans: [],
  code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
  designCandidates: [],
  health: { alerts: [], running: 0, healthy: 0 },
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cockpit shell DOM 集成（真实执行 clientScript）", () => {
  beforeEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/api/view")) {
        const route = new URL(url, "http://x").searchParams.get("route") || "#/overview";
        // sentinel 故意不出现在服务端首屏 renderOverview 中 → 注入与否、注对路由与否都可判别。
        return {
          text: async () => {
            if (route === "#/inbox") return '<section class="from-fetch">控制门 · INBOX_FETCH_MARK</section>';
            if (route === "#/workbench") return '<section class="from-fetch">工作台 · WB_FETCH_MARK</section>';
            if (route.indexOf("#/project/") === 0) return '<section class="from-fetch">项目 · PROJECT_FETCH_MARK</section>';
            return '<section class="from-fetch">在跑什么 · OV_FETCH_MARK</section>';
          },
        };
      }
      return { json: async () => ({}) };
    });
    window.location.hash = "";
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  test("导航锚点化、active 随 hash 迁移、fetch 注入对的片段", async () => {
    const html = renderShell(state, { projectName: "kunpeng", projectId: "kunpeng" });
    // 注入 body（innerHTML 不会执行 <script>），再手动取脚本文本执行。
    // 剥掉外链 <script src>（如 cytoscape CDN）：happy-dom 会尝试加载并抛 DOMException，
    // 且它的 textContent 为空——必须取内联脚本（clientScript），不能靠 querySelector("script") 取第一个。
    const body = html
      .replace(/^[\s\S]*?<body>/, "")
      .replace(/<\/body>[\s\S]*$/, "")
      .replace(/<script\s+src=[^>]*><\/script>/g, "");
    document.body.innerHTML = body;
    // 取最长的内联脚本=clientScript；「第一个 >100 字符」会抓到排前面的 SW 注册脚本（PWA 上线后~140字符）。
    const code = [...document.querySelectorAll("script")]
      .map((s) => s.textContent ?? "")
      .reduce((longest, t) => (t.length > longest.length ? t : longest), "");
    expect(code.length).toBeGreaterThan(100);
    new Function(code)();
    await tick();
    await tick();

    const overviewLink = document.querySelector('a[href="#/overview"]');
    const workbenchLink = document.querySelector('a[href="#/workbench"]');
    const inboxLink = document.querySelector('a[href="#/inbox"]');
    expect(overviewLink, "总览必须是 <a href> 锚点").toBeTruthy();
    expect(workbenchLink, "工作台必须是 <a href> 锚点").toBeTruthy();
    expect(inboxLink, "待我处理必须是 <a href> 锚点").toBeTruthy();

    const view = document.getElementById("view")!;
    // 初始：工作台 active + #view 被 fetch 的 workbench 片段注入（含 sentinel，证明注入真发生）。
    expect(workbenchLink!.classList.contains("active")).toBe(true);
    expect(overviewLink!.classList.contains("active")).toBe(false);
    expect(view.innerHTML).toContain("WB_FETCH_MARK");

    // 切到 inbox：active 迁移、#view 换成 inbox 片段（含 INBOX sentinel，且不再含 overview sentinel）
    window.location.hash = "#/inbox";
    window.dispatchEvent(new Event("hashchange"));
    await tick();
    await tick();
    expect(inboxLink!.classList.contains("active")).toBe(true);
    expect(overviewLink!.classList.contains("active")).toBe(false);
    expect(view.innerHTML).toContain("INBOX_FETCH_MARK");
    expect(view.innerHTML).not.toContain("OV_FETCH_MARK");

    // 切回 overview：fetch 重取 overview 片段恢复（HIGH-2：不被销毁），且不再含 inbox sentinel
    window.location.hash = "#/overview";
    window.dispatchEvent(new Event("hashchange"));
    await tick();
    await tick();
    expect(overviewLink!.classList.contains("active")).toBe(true);
    expect(view.innerHTML).toContain("OV_FETCH_MARK");
    expect(view.innerHTML).not.toContain("INBOX_FETCH_MARK");

    // 切到项目子路由 #/project/kunpeng/plans：项目基链接高亮 + fetch 注入项目片段（堵子路由 wiring 盲区 + setSidebarActive 子路由高亮）
    const projectLink = document.querySelector('a[href="#/project/kunpeng"]');
    expect(projectLink, "项目必须是 <a href> 锚点").toBeTruthy();
    window.location.hash = "#/project/kunpeng/plans";
    window.dispatchEvent(new Event("hashchange"));
    await tick();
    await tick();
    expect(projectLink!.classList.contains("active"), "项目子路由下项目基链接应高亮").toBe(true);
    expect(overviewLink!.classList.contains("active")).toBe(false);
    expect(view.innerHTML).toContain("PROJECT_FETCH_MARK");
    expect(view.innerHTML).not.toContain("OV_FETCH_MARK");
  });
});
