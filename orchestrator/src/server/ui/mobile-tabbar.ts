import { countActionableGates, type DashboardState } from "../state.js";

export interface MobileNavOpts {
  projectName?: string;
  projectId?: string;
  projects?: { id: string; name: string }[];
}

function activeClass(active: string, key: string): string {
  return active === key ? " active" : "";
}

function icon(paths: string): string {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

function tab(active: string, key: string, href: string, paths: string, label: string, badge = ""): string {
  return `<a class="kp-tab${activeClass(active, key)}" href="${href}">${icon(paths)}<span>${label}</span>${badge}</a>`;
}

function sheetLink(active: string, key: string, href: string, paths: string, label: string): string {
  return `<a class="kp-more-link${activeClass(active, key)}" href="${href}">${icon(paths)}<span>${label}</span></a>`;
}

function projectName(state: DashboardState, opts: MobileNavOpts): string {
  if (opts.projectName) return opts.projectName;
  const branch = state.branches?.[0];
  if (branch) return branch.replace(/^kp\//, "");
  return "当前项目";
}

export function renderMobileNav(state: DashboardState, active: string, opts: MobileNavOpts = {}): string {
  const gateCount = state.reviewQueue
    ? countActionableGates(state.reviewQueue)
    : (state.humanGates?.length ?? 0) +
      ((state.artifacts?.["release"] ?? []).filter((a) => a.status === "draft").length) +
      ((state.artifacts?.["connector"] ?? []).filter((a) => a.status === "draft").length);
  const gateBadge = gateCount > 0 ? `<b class="kp-tab-badge">${gateCount}</b>` : "";
  const projectHref = `#/project/${encodeURIComponent(opts.projectId || projectName(state, opts))}`;

  return `<input id="kp-more-toggle" class="kp-more-toggle" type="checkbox" aria-hidden="true">
  <label class="kp-more-backdrop" for="kp-more-toggle" aria-label="关闭更多菜单"></label>
  <nav class="kp-more-sheet" aria-label="更多导航">
    <div class="kp-more-title">更多</div>
    <button type="button" class="kp-more-link" data-kp-palette="1">${icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>')}<span>搜索 / 快速跳转</span></button>
    ${sheetLink(active, "tasks", "#/tasks", '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m4 6 1 1 2-2"/><path d="m4 12 1 1 2-2"/><path d="m4 18 1 1 2-2"/>', "任务台")}
    ${sheetLink(active, "insights", "#/insights", '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/>', "洞察")}
    ${sheetLink(active, "library", "#/library", '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', "资料库")}
    ${sheetLink(active, "solutions", "#/solutions", '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>', "方案")}
    ${sheetLink(active, "skills", "#/skills", '<path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4z"/>', "技能")}
    ${sheetLink(active, "docs", "#/docs", '<path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', "文档")}
    ${sheetLink(active, "register-project", "#/register-project", '<path d="M5 12h14"/><path d="M12 5v14"/>', "接管新项目")}
    ${sheetLink(active, "evolution", "#/evolution", '<path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3.4"/>', "自进化")}
    ${sheetLink(active, "architecture", "#/architecture", '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="7" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="18" r="1.5"/>', "架构")}
    ${sheetLink(active, "terminal", "#/terminal", '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>', "终端")}
    ${sheetLink(active, "loops", "#/loops", '<path d="M4 17c3-8 8-8 16-8"/><path d="M4 17h5"/><path d="M15 9h5v5"/><circle cx="7" cy="17" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="19" cy="9" r="2"/>', "运营 loop")}
    ${sheetLink(active, "knowledge", "#/knowledge", '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', "知识库")}
    ${sheetLink(active, "switchboard", "#/switchboard", '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>', "通讯")}
    ${sheetLink(active, "settings", "#/settings", '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', "设置")}
    <a class="kp-more-link" href="/plugins">${icon('<path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4z"/>')}<span>插件</span></a>
    <a class="kp-more-link" href="/help">${icon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.2 2c-1.3 1.1-2.3 1.7-2.3 3"/><path d="M12 18h.01"/>')}<span>帮助</span></a>
  </nav>
  <nav class="kp-tabbar" aria-label="移动端主导航">
    ${tab(active, "overview", "#/overview", '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-8h6v8"/>', "总览", '<b class="kp-tab-badge" data-kp-attn hidden>0</b>')}
    ${tab(active, "inbox", "#/inbox", '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>', "待办", gateBadge)}
    ${tab(active, "workbench", "#/workbench", '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>', "工作台")}
    ${tab(active, "project", projectHref, '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', "项目")}
    <label class="kp-tab kp-more-tab" for="kp-more-toggle">${icon('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>')}<span>更多</span></label>
  </nav>`;
}
