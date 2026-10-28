import type { DashboardState } from "../../state.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

function searchableText(...parts: unknown[]): string {
  return parts.map((part) => String(part ?? "")).join(" ").toLocaleLowerCase();
}

export function renderLibrary(
  state: Pick<DashboardState, "solutionCatalog" | "docsCatalog" | "skillCatalog">,
): string {
  const templates = state.solutionCatalog ?? [];
  const docs = state.docsCatalog ?? [];
  const skills = state.skillCatalog ?? [];
  const total = templates.length + docs.length + skills.length;

  const templateCards = templates.map((entry) => `<div class="ops-card" data-lib-item data-lib-kind="template" data-lib-text="${escapeHtml(searchableText(entry.name, entry.description))}">
    <div class="ops-card-title">${escapeHtml(entry.name)}</div>
    <div class="hint"><span class="tag">方案模板</span> ${escapeHtml(entry.description)}</div>
  </div>`).join("");

  const docCards = docs.map((entry) => {
    const href = `/doc?name=${encodeURIComponent(entry.name)}`;
    return `<div class="ops-card" data-lib-item data-lib-kind="doc" data-lib-text="${escapeHtml(searchableText(entry.title, entry.name))}">
      <div class="ops-card-title"><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(entry.title)}</a></div>
      <div class="hint"><span class="tag">文档</span> ${escapeHtml(entry.name)}</div>
    </div>`;
  }).join("");

  const skillCards = skills.map((entry) => `<div class="ops-card" data-lib-item data-lib-kind="skill" data-lib-text="${escapeHtml(searchableText(entry.name, entry.description))}">
    <div class="ops-card-title">${escapeHtml(entry.name)}</div>
    <div class="hint"><span class="tag">技能</span> ${escapeHtml(entry.description)}</div>
  </div>`).join("");

  const emptyState = total === 0
    ? `<div class="empty-state" data-lib-empty>
        <div class="empty-title">资料库暂无内容</div>
        <div class="hint">可以从下方入口添加方案、文档、知识或技能。</div>
      </div>`
    : `<div class="empty-state" data-lib-empty hidden>
        <div class="empty-title">资料库暂无匹配内容</div>
      </div>`;

  return `<div class="topbar"><span class="crumb">资料库</span><span class="hint">${escapeHtml(total)} 项已收录</span></div>
    <div class="body">
      <div class="wrap">
        <div class="runs" data-panel="library-filter">
          <div class="run">
            <input class="name" type="text" data-lib-search placeholder="搜索资料库">
            <button class="b pri" type="button" data-lib-type="all" aria-pressed="true">全部</button>
            <button class="b" type="button" data-lib-type="template" aria-pressed="false">方案模板</button>
            <button class="b" type="button" data-lib-type="doc" aria-pressed="false">文档</button>
            <button class="b" type="button" data-lib-type="capture" aria-pressed="false">知识</button>
            <button class="b" type="button" data-lib-type="skill" aria-pressed="false">技能</button>
          </div>
        </div>
        <div data-lib-grid data-lib-active-type="all">
          ${templateCards}${docCards}${skillCards}
          <div data-lib-captures></div>
          ${emptyState}
        </div>
        <div class="actions">
          <a class="b" href="#/knowledge">知识工作台</a>
          <a class="b" href="#/solutions">方案模板页</a>
          <a class="b" href="#/skills">技能管理</a>
          <a class="b" href="#/docs">文档库</a>
        </div>
      </div>
    </div>`;
}
