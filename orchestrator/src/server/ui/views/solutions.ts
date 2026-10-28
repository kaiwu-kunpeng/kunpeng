import type { DashboardState } from "../../state.js";
import { renderEmptyState } from "../empty-state.js";
import { renderUsageGuide } from "../guide.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

type LegacySolutionsState = NonNullable<DashboardState["solutions"]>;

function renderInstalledProjects(
  template: LegacySolutionsState["templates"][number],
  projects: LegacySolutionsState["projects"],
): string {
  const installed = new Set(template.installed);
  const installedProjects = projects.filter((project) => installed.has(project.id));
  if (installedProjects.length === 0) return "";

  return `<div class="hint">已装入 ${installedProjects.map((project) => `<code>${escapeHtml(project.name)}</code>`).join(" ")}</div>`;
}

function renderApplyButtons(
  template: LegacySolutionsState["templates"][number],
  projects: LegacySolutionsState["projects"],
): string {
  const installed = new Set(template.installed);
  return projects
    .filter((project) => !installed.has(project.id))
    .map((project) => `<button class="btn" data-solution-apply="${escapeHtml(template.id)}" data-project="${escapeHtml(project.id)}">装入 ${escapeHtml(project.name)}</button>`)
    .join("");
}

function renderLegacyTemplates(solutions: LegacySolutionsState): string {
  return solutions.templates.map((template) => {
    const description = template.description ? `<div class="hint">${escapeHtml(template.description)}</div>` : "";
    const actions = renderApplyButtons(template, solutions.projects);
    return `<div class="ops-card" data-solution="${escapeHtml(template.id)}">
      <div class="ops-card-title">${escapeHtml(template.name)} <code>${escapeHtml(template.id)}</code></div>
      ${description}
      <div class="hint"><span class="tag">${escapeHtml(template.playbookCount)} 张 playbook</span> <span class="tag">${escapeHtml(template.playbookCount)} 张卡</span> <span class="tag">${escapeHtml(template.loopCount)} 个 loop</span></div>
      ${renderInstalledProjects(template, solutions.projects)}
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </div>`;
  }).join("");
}

export function renderSolutions(state: Pick<DashboardState, "solutionCatalog">): string {
  const legacy = (state as Pick<DashboardState, "solutions">).solutions;
  const hasCatalog = state.solutionCatalog !== undefined;
  const catalog = state.solutionCatalog ?? legacy?.templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    playbookCount: template.playbookCount,
  })) ?? [];
  const guide = renderUsageGuide({
    id: "solutions",
    title: "方案库怎么用",
    intro: "把稳定的运营组合保存成方案，再在新项目里复用。",
    steps: [
      { label: "保存方案", detail: "从当前项目沉淀方案模板", cmd: "kunpeng solution save ..." },
      { label: "查看方案", detail: "列出已保存的方案模板", cmd: "kunpeng solution list" },
      { label: "应用方案", detail: "把方案模板装入目标项目", cmd: "kunpeng solution apply ..." },
    ],
  });
  const body = catalog.length === 0
    ? renderEmptyState({
        title: "还没有方案模板",
        hint: "kunpeng solution save ... 把项目里的运营组合存成模板",
      })
    : legacy && !hasCatalog
      ? renderLegacyTemplates(legacy)
    : catalog.map((entry) => {
        return `<div class="ops-card" data-solution="${escapeHtml(entry.id)}">
          <div class="ops-card-title">${escapeHtml(entry.name)} <code>${escapeHtml(entry.id)}</code></div>
          <div class="hint">${escapeHtml(entry.description)}</div>
          <div class="hint"><span class="tag">${escapeHtml(entry.playbookCount)} 张 playbook</span></div>
        </div>`;
      }).join("");

  return `<div class="topbar"><span class="crumb">方案库</span><span class="hint">${escapeHtml(catalog.length)} 个方案</span></div>
    <div class="body">
      <div class="wrap">${guide}${body}</div>
    </div>`;
}
