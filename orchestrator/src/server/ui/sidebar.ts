import { userInfo } from "node:os";
import { countActionableGates, type DashboardState } from "../state.js";
import { LOGO_SVG } from "./brand-assets.js";
import { escHtml as escapeHtml } from "../../util/esc-html.js";

export interface SidebarOpts {
  /** 当前项目展示名（由 http 层从 repoRoot/注册表注入）。缺省时退回分支名，绝不用方案 id 当项目名。 */
  projectName?: string;
  projectId?: string;
  projects?: { id: string; name: string }[];
}

function activeClass(active: string, key: string): string {
  return active === key ? " active" : "";
}

function icon(paths: string): string {
  return `<svg class="i" viewBox="0 0 24 24">${paths}</svg>`;
}

/** 可路由项渲染成 <a href="#/..">（client 的 setSidebarActive 靠 a[href^="#/"] 选中并高亮）。 */
function navLink(active: string, key: string, href: string, paths: string, label: string, trailing = ""): string {
  return `<a class="nav-item${activeClass(active, key)}" href="${href}">${icon(paths)}<span class="lbl">${label}</span>${trailing}</a>`;
}

function projectName(state: DashboardState, opts: SidebarOpts): string {
  if (opts.projectName) return opts.projectName;
  const branch = state.branches?.[0];
  if (branch) return branch.replace(/^kp\//, "");
  return "当前项目";
}

const projectIcon = '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>';

export function renderSidebar(state: DashboardState, active: string, opts: SidebarOpts = {}): string {
  const gateCount = state.reviewQueue
    ? countActionableGates(state.reviewQueue)
    : (state.humanGates?.length ?? 0) +
      ((state.artifacts?.["release"] ?? []).filter((a) => a.status === "draft").length) +
      ((state.artifacts?.["connector"] ?? []).filter((a) => a.status === "draft").length);
  const gateBadge = gateCount > 0 ? `<span class="badge">${gateCount}</span>` : "";
  const projectLinks = opts.projects?.length
    ? opts.projects
        .map((project) =>
          navLink(active, "project", `#/project/${encodeURIComponent(escapeHtml(project.id))}`, projectIcon, escapeHtml(project.name)),
        )
        .join("\n  ")
    : navLink(
        active,
        "project",
        `#/project/${encodeURIComponent(escapeHtml(opts.projectId || projectName(state, opts)))}`,
        projectIcon,
        escapeHtml(projectName(state, opts)),
        '<span class="dot dot-primary"></span>',
      );
  const moreActive = [
    "tasks",
    "register-project",
    "evolution",
    "architecture",
    "terminal",
    "switchboard",
    "settings",
  ].includes(active);
  const railUser = (() => {
    try {
      return userInfo().username || "鲲鹏";
    } catch {
      return "鲲鹏";
    }
  })();

  return `<aside class="rail">
  <div class="brand"><span class="logo">${LOGO_SVG.replace(/width="512" height="512"/, 'width="34" height="34"')}</span><span class="lbl"><div class="wm">鲲鹏</div><div class="sub2">AI 研发与运营操作系统</div></span></div>
  <div class="kbar">${icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>')}<span class="lbl">搜索 / 跳转</span><span class="kbd">⌘K</span></div>
  ${navLink(active, "overview", "#/overview", '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-8h6v8"/>', "总览", '<span class="kp-attn-badge" data-kp-attn hidden>0</span>')}
  ${navLink(active, "workbench", "#/workbench", '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>', "对话")}
  ${navLink(active, "inbox", "#/inbox", '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>', "待我处理", gateBadge)}
  <div class="nav-sec">项目</div>
  ${projectLinks}
  ${navLink(active, "library", "#/library", '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', "资料库")}
  ${navLink(active, "loops", "#/loops", '<path d="M4 17c3-8 8-8 16-8"/><path d="M4 17h5"/><path d="M15 9h5v5"/><circle cx="7" cy="17" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="19" cy="9" r="2"/>', "运营平台")}
  ${navLink(active, "insights", "#/insights", '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/>', "洞察")}
  <details data-nav-more${moreActive ? " open" : ""}>
    <summary class="nav-item"><span class="lbl">更多</span></summary>
    ${navLink(active, "tasks", "#/tasks", '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m4 6 1 1 2-2"/><path d="m4 12 1 1 2-2"/><path d="m4 18 1 1 2-2"/>', "任务台")}
    ${navLink(active, "register-project", "#/register-project", '<path d="M5 12h14"/><path d="M12 5v14"/>', "接管新项目")}
    ${navLink(active, "evolution", "#/evolution", '<path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.4"/>', "自进化")}
    ${navLink(active, "architecture", "#/architecture", '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="7" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="18" r="1.5"/>', "架构")}
    ${navLink(active, "terminal", "#/terminal", '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>', "终端")}
    ${navLink(active, "switchboard", "#/switchboard", '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>', "通讯")}
    ${navLink(active, "settings", "#/settings", '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82-.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', "设置")}
    <a class="nav-item" href="/plugins" target="_blank" rel="noopener">${icon('<path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4z"/>')}<span class="lbl">插件</span></a>
    <a class="nav-item" href="/help" target="_blank" rel="noopener">${icon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.2 2c-1.3 1.1-2.3 1.7-2.3 3"/><path d="M12 18h.01"/>')}<span class="lbl">帮助</span></a>
  </details>
  <div class="rail-foot"><span class="avatar">${escapeHtml(railUser.slice(0, 1).toUpperCase())}</span><span class="lbl">${escapeHtml(railUser)}</span><span class="spacer"></span><span class="caret">▾</span></div>
</aside>`;
}
