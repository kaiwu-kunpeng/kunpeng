import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { htmlDocTitle } from "./state-title-helpers.js";
import type {
  DashboardState,
  DocEntry,
  ProjectSnapshot,
  SkillCatalogSource,
  SolutionOverviewEntry,
} from "./state-types.js";

export function buildDocsOverview(dir: string): DocEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".html"));
  } catch {
    return [];
  }

  const docs: DocEntry[] = [];
  for (const name of files) {
    try {
      const path = join(dir, name);
      const raw = readFileSync(path, "utf8");
      const info = statSync(path);
      docs.push({
        name,
        title: htmlDocTitle(raw, name),
        updatedAt: info.mtimeMs,
      });
    } catch {
      // 单个坏文件不能拖垮文档库。
    }
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildSolutionsOverview(
  templates: Array<{ id: string; name: string; description?: string; playbookFiles?: string[] }>,
): SolutionOverviewEntry[] {
  return [...templates]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      playbookCount: (template.playbookFiles ?? []).length,
    }));
}

export function buildSkillsOverview(
  entries: SkillCatalogSource[],
  snapshots: ProjectSnapshot[],
): NonNullable<DashboardState["skillCatalog"]> {
  const usageBySkill = new Map<string, Array<{ projectId: string; playbookId: string }>>();
  for (const snapshot of snapshots) {
    for (const playbook of snapshot.state.playbooks ?? []) {
      for (const skillId of playbook.skills ?? []) {
        const usage = usageBySkill.get(skillId) ?? [];
        usage.push({ projectId: snapshot.id, playbookId: playbook.id });
        usageBySkill.set(skillId, usage);
      }
    }
  }

  return [...entries]
    .filter((entry) => entry.enabled !== false)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      origin: entry.origin,
      ...(entry.layer ? { layer: entry.layer } : {}),
      ...(entry.tags ? { tags: [...entry.tags] } : {}),
      ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
      ...(entry.category !== undefined ? { category: entry.category } : {}),
      usedBy: usageBySkill.get(entry.id) ?? [],
    }));
}
