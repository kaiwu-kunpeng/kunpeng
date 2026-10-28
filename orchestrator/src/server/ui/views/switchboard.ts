import { escHtml } from "../../../util/esc-html.js";
import type { DashboardState } from "../../state.js";
import { renderEmptyState } from "../empty-state.js";

/**
 * 通讯视图：跨实例交换机（switchboard）的人类驾驶舱。
 * 按救命优先级排版——顶部是「没人接的紧急消息」红色告警，其次在线实例、消息流、发送表单。
 * 静态壳由 client 在进入路由时拉 escalations/presence/inbox 填充，并轮询刷新（switchboard 是"拉"不是"推"）。
 */
export function renderSwitchboard(state: DashboardState): string {
  void state;

  return `
    <div class="body">
      <div class="wrap">
        <div class="section-h">
          <h3>${escHtml("通讯")}</h3>
          <span class="hint">${escHtml("跨实例交换机 · 谁在线 · 谁的紧急消息没人接")}</span>
        </div>
        <div class="lead"><span>${escHtml("交换机是“拉”不是“推”——这里替你盯着：没人收或超时未读的紧急消息会顶到最上面，需人类介入。")}</span></div>

        <div id="sb-escalations" data-panel="sb-escalations">
          <div class="run empty"><span class="name">加载中…</span></div>
        </div>

        <div class="section-h">
          <h3>${escHtml("在线实例")}</h3>
          <span class="hint">${escHtml("谁活着 / 在读 inbox")}</span>
        </div>
        <div class="runs" id="sb-presence" data-panel="sb-presence">
          <div class="run empty"><span class="name">加载中…</span></div>
        </div>

        <div class="section-h">
          <h3>${escHtml("发消息")}</h3>
          <span class="hint">${escHtml("发给某个实例 · 勾紧急即进升级队列")}</span>
        </div>
        <div class="runs" data-panel="sb-send">
          <div class="run">
            <input type="text" class="name" data-sb-to placeholder="发给（实例名，如 main / r1 / web）" style="max-width:240px">
            <input type="text" class="name" data-sb-topic placeholder="主题（可选）" style="max-width:200px">
            <label class="muted" style="display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" data-sb-urgent>紧急</label>
          </div>
          <div class="run">
            <textarea class="name" data-sb-body placeholder="消息正文…"></textarea>
            <button class="b pri" data-action="sb-send">发送</button>
          </div>
        </div>

        <div class="section-h">
          <h3>${escHtml("消息流")}</h3>
          <span class="hint">${escHtml("收件箱 · 紧急置顶 · 进入此页即标记已读")}</span>
        </div>
        <div class="runs" id="sb-inbox" data-panel="sb-inbox">
          ${renderEmptyState({
            title: "暂无实例消息",
            hint: "其它会话开工/喊话会实时出现在这里",
          })}
        </div>
      </div>
    </div>
  `;
}
