import type { DashboardState } from "../../state.js";

/**
 * 远程工作台第二期 · 常驻 shell 终端视图(纯字符串渲染)。
 * 只渲染挂载容器、标签栏与状态条;真正的 xterm 多实例化、WebSocket 连接、标签切换
 * 由 client.ts 的 initTerminal 接管(多开:每标签一个会话,× 关闭即杀进程)。
 * workspaceId 由客户端在挂载时按当前工作区(currentProjectId)解析,故此处不写死。
 */
export function renderTerminal(_state: DashboardState): string {
  return `<section class="kp-terminal">
  <div class="section-h">常驻终端 <span class="muted" id="kp-term-status">未连接</span></div>
  <p class="muted">在这台 Mac 上开常驻 shell:可多开、断线自动重连、恢复滚屏。切到别的页会话仍在后台存活;点标签上的 <b>×</b> 会关闭并杀掉该会话进程。</p>
  <div class="kp-term-bar" style="display:flex;align-items:center;gap:8px">
    <button id="kp-term-new" class="btn">新建会话</button>
    <span class="muted" id="kp-term-session"></span>
  </div>
  <div id="kp-term-tabs" class="kp-term-tabs" style="margin-top:8px;min-height:26px;display:flex;flex-wrap:wrap;gap:4px"></div>
  <div id="kp-term-host" class="kp-term-host" role="application" aria-label="远程终端" style="height:66vh;min-height:340px;background:var(--term-bg);border-radius:0 10px 10px 10px;padding:8px;overflow:hidden;position:relative"></div>
</section>`;
}
