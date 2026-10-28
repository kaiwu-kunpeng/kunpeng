import type { DashboardState } from "../../state.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

export function renderDocs(state: Pick<DashboardState, "docsCatalog">): string {
  const docs = state.docsCatalog ?? [];
  const body = docs.length === 0
    ? `<div class="empty-state">
        <div class="empty-title">还没有文档</div>
        <div class="hint">把 .html 文档放到默认目录 kunpeng-strategy-docs 后刷新。</div>
      </div>`
    : docs.map((entry) => {
        const href = `/doc?name=${encodeURIComponent(entry.name)}`;
        return `<div class="ops-card" data-doc="${escapeHtml(entry.name)}">
          <div class="ops-card-title"><a href="${escapeHtml(href)}" target="_blank">${escapeHtml(entry.title)}</a></div>
          <span class="hint">${escapeHtml(entry.name)}</span>
        </div>`;
      }).join("");

  return `<div class="topbar"><span class="crumb">文档库</span><span class="hint">${escapeHtml(docs.length)} 份文档</span></div>
    <div class="body">
      <div class="wrap">${body}</div>
    </div>`;
}
