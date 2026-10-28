import type { DriverEvent } from "../../loop/workspace-driver.js";
import { formatChatUsageLine } from "../chat-usage.js";
import { escHtml as escapeHtml } from "../../util/esc-html.js";

function optionalNumber(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** 纯函数:把一个 DriverEvent 渲成一段 HTML(无副作用)。所有动态文本 HTML 转义。 */
export function renderDriverEvent(ev: DriverEvent): string {
  switch (ev.type) {
    case "stage":
      return `<div class="kp-ev kp-ev-stage">阶段:${escapeHtml(ev.stage)}</div>`;
    case "token":
      return `<span class="kp-ev-token">${escapeHtml(ev.text)}</span>`;
    case "file-changed":
      return `<div class="kp-ev kp-ev-file">${escapeHtml(ev.path)} (+${optionalNumber(ev.added)}/-${optionalNumber(ev.removed)})</div>`;
    case "gate-needed": {
      const gateId = escapeHtml(ev.gateId);
      return `<div class="kp-ev kp-ev-gate" data-gate="${gateId}">${escapeHtml(ev.what)} <button data-gate-yes="${gateId}">是</button><button data-gate-no="${gateId}">否</button></div>`;
    }
    case "usage":
      return `<div class="kp-ev kp-ev-usage">${escapeHtml(formatChatUsageLine(ev))}</div>`;
    case "done":
      return `<div class="kp-ev kp-ev-done">完成${ev.summary === undefined ? "" : `・${escapeHtml(ev.summary)}`}</div>`;
    case "error":
      return `<div class="kp-ev kp-ev-error">出错:${escapeHtml(ev.reason)}</div>`;
    default: {
      const exhaustive: never = ev;
      return exhaustive;
    }
  }
}
