import { themeCss } from "./theme.js";
import { renderSidebar } from "./sidebar.js";
import { renderMobileNav } from "./mobile-tabbar.js";
import { renderOverview } from "./views/overview.js";
import { clientScript } from "./client.js";
import type { DashboardState } from "../state.js";
import { escHtml as escapeHtml } from "../../util/esc-html.js";

export function renderWorkspaceSwitcher(
  projects: { id: string; name: string }[] = [],
  opts: { username?: string } = {},
): string {
  const projectOptions = projects
    .map((project) => `<option value="#/project/${encodeURIComponent(project.id)}">${escapeHtml(project.name)}</option>`)
    .join("");
  const username = opts.username;
  const userControls = typeof username === "string" && username.length > 0
    ? `<span class="kp-user" title="当前账号">👤 ${escapeHtml(username)}</span><a class="kp-logout" href="/api/logout" title="退出并切换账号">退出登录</a>`
    : "";
  const modeAccount = typeof username === "string" ? escapeHtml(username) : "";

  return `<div id="kp-mode-strip" class="kp-mode-strip" aria-hidden="true"></div>
      <div class="kp-topbar">
        <span class="kp-ws-label">工作区</span>
        <select id="kp-workspace-switcher" class="kp-ws-select">
          <option value="#/overview">全部工作区</option>${projectOptions}
        </select>
        <span class="spacer"></span>
        <span id="kp-status-pill" class="kp-status-pill" aria-live="polite" title="跨项目运行态" style="display:none"></span>
        ${userControls}
        <div class="kp-mode" role="group" aria-label="工作模式" data-kp-account="${modeAccount}">
          <span id="kp-mode-dot" class="kp-mode-dot" aria-hidden="true"></span>
          <select id="kp-mode-select" class="kp-mode-select" aria-label="工作模式">
            <option value="full" title="不加限制">满血模式</option>
            <option value="intranet" title="只是个标记，工具权限与满血一致，不是网络隔离">内网模式</option>
            <option value="trip" title="不能读写或执行本机，改用工作机 ws_*">出差模式</option>
          </select>
        </div>
        <div class="theme-toggle" role="group" aria-label="皮肤切换">
          <button type="button" data-theme-set="light" aria-label="白天皮肤">☀️ 白天</button>
          <button type="button" data-theme-set="dark" aria-label="夜间皮肤">🌙 夜间</button>
        </div>
      </div>`;
}

export function renderShell(
  state: DashboardState,
  opts: { projectName?: string; projectId?: string; projects?: { id: string; name: string }[]; username?: string } = {},
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#8D4B00">
  <title>鲲鹏 · 总览</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon-192.png" type="image/png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="鲲鹏">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:375px) and (device-height:667px) and (-webkit-device-pixel-ratio:2)" href="/splash-750x1334.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:390px) and (device-height:844px) and (-webkit-device-pixel-ratio:3)" href="/splash-1170x2532.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:393px) and (device-height:852px) and (-webkit-device-pixel-ratio:3)" href="/splash-1179x2556.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:3)" href="/splash-1242x2688.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:428px) and (device-height:926px) and (-webkit-device-pixel-ratio:3)" href="/splash-1284x2778.png">
  <link rel="apple-touch-startup-image" media="screen and (device-width:430px) and (device-height:932px) and (-webkit-device-pixel-ratio:3)" href="/splash-1290x2796.png">
  <link rel="stylesheet" href="/vendor/xterm.min.css">
  <style>${themeCss}</style>
</head>
<body>
  <div class="app">
    ${renderSidebar(state, "overview", opts)}
    <main class="canvas">
      ${renderWorkspaceSwitcher(opts.projects, { username: opts.username })}
      <h1 class="sr-only">鲲鹏 · AI 研发底座总控台</h1>
      <div id="view" tabindex="0" role="region" aria-label="主视图">${renderOverview(state)}</div>
    </main>
  </div>
  ${renderMobileNav(state, "overview", opts)}
  <script>
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
    }
  </script>
  <script>${clientScript}</script>
</body>
</html>`;
}
