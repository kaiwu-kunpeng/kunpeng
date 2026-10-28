import type { DashboardState } from "../../state.js";
import { renderEmptyState } from "../empty-state.js";
import { renderUsageGuide } from "../guide.js";
import { escHtml as escapeHtml } from "../../../util/esc-html.js";

function originLabel(origin: string): string {
  if (origin === "authored") return "自研";
  if (origin === "vendored") return "引入";
  if (origin === "distilled") return "蒸馏";
  return origin;
}

function headerSummary(catalog: NonNullable<DashboardState["skillCatalog"]>): string {
  const counts = new Map<string, number>();
  for (const skill of catalog) counts.set(skill.origin, (counts.get(skill.origin) ?? 0) + 1);

  const parts = [`${catalog.length} 个技能`];
  for (const origin of ["vendored", "authored", "distilled"]) {
    const count = counts.get(origin);
    if (count) parts.push(`${count} ${origin}`);
  }
  return parts.join(" ｜ ");
}

function renderTags(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  return `<div class="hint">${tags.map((tag) => `<span class="tag tag-idle">${escapeHtml(tag)}</span>`).join(" ")}</div>`;
}

function renderUsedBy(usedBy: Array<{ projectId?: string; playbookId: string }>): string {
  const detail = usedBy.length > 0
    ? `<div class="hint">${usedBy.map((ref) => {
        const project = ref.projectId ? `${escapeHtml(ref.projectId)}/` : "";
        return `<code>${project}${escapeHtml(ref.playbookId)}</code>`;
      }).join(" ")}</div>`
    : "";
  return `<div class="hint">被引用 ${usedBy.length} 处</div>${detail}`;
}

export function renderSkills(state: Pick<DashboardState, "skillCatalog">): string {
  const catalog = state.skillCatalog ?? [];
  const guide = renderUsageGuide({
    id: "skills",
    title: "技能库怎么用",
    intro: "把可复用的能力注册成技能，再在 playbook 或任务里引用。",
    steps: [
      { label: "注册技能", detail: "把本地技能目录加入 catalog", cmd: "kunpeng skill add <id> --dir <目录>" },
      { label: "查看引用", detail: "在技能卡片里检查被哪些项目和 playbook 使用" },
      { label: "沉淀复用", detail: "把稳定动作写进 playbook，后续运营流可直接调用" },
    ],
  });
  const body = catalog.length === 0
    ? renderEmptyState({
        title: "还没有技能",
        hint: "kunpeng skill add <id> --dir <目录> 注册技能",
      })
    : catalog.map((skill) => {
        const layer = skill.layer ? `<span class="tag">${escapeHtml(skill.layer)}</span>` : "";
        const category = skill.category ? `<span class="tag">${escapeHtml(skill.category)}</span>` : "";
        const description = skill.description ? `<div class="hint">${escapeHtml(skill.description)}</div>` : "";
        return `<div class="ops-card" data-skill="${escapeHtml(skill.id)}">
          <div class="ops-card-title">${escapeHtml(skill.name)} <code>${escapeHtml(skill.id)}</code></div>
          <div class="hint"><span class="tag">${escapeHtml(originLabel(skill.origin))}</span> ${category} ${layer}</div>
          ${renderTags(skill.tags)}
          ${description}
          ${renderUsedBy(skill.usedBy)}
        </div>`;
      }).join("");

  return `<div class="topbar"><span class="crumb">技能库</span><span class="hint">${escapeHtml(headerSummary(catalog))}</span></div>
    <div class="body">
      <div class="wrap">${guide}${body}</div>
    </div>`;
}
