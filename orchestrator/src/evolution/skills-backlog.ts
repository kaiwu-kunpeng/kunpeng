import { stableHash, type ReinjectTask } from "../feedback/finding-to-task.js";
import type { ProposedChange } from "../loop/self-evolution.js";
import { scanSkillSafety } from "../skills/skill-safety.js";

export const SKILLS_BACKLOG_PREFIX = "[proposal-skill]";
export const SKILLS_BACKLOG_SOURCE = "proposal:skills";
export const SKILL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function skillsBacklogTask(slug: string, content: string): ReinjectTask {
  return {
    fingerprint: stableHash(`${SKILLS_BACKLOG_SOURCE}|${slug}|${content}`),
    source: SKILLS_BACKLOG_SOURCE,
    severity: "error",
    requirement: [
      `${SKILLS_BACKLOG_PREFIX} 把已批准的蒸馏技能 ${slug} 固化到 skills/${slug}/SKILL.md`,
      `只改 skills/${slug}/SKILL.md 这一个文件，内容必须与下面原文逐字一致（含 frontmatter）；文件已存在则整体覆盖。`,
      "spec 必须单 H1（分节用粗体，不用 ##），必带 scope 块（每行一条）：",
      `allow: skills/${slug}/SKILL.md`,
      "forbid: constitution/**",
      "forbid: orchestrator/**",
      "验收命令原样使用下面这一条（不得改写、不得删减）：",
      `test -f skills/${slug}/SKILL.md && grep -qF -- 'name: ${slug}' skills/${slug}/SKILL.md && ! grep -qE '^(model|sandbox|mcp|mcp-servers|mcpServers):' skills/${slug}/SKILL.md`,
      "技能原文（每行前 4 个空格是缩进，落盘时去掉）：",
      ...content.split("\n").map((line) => `    ${line}`),
    ].join("\n"),
  };
}

export interface SkillsApplierDeps {
  readDraft(slug: string): Promise<string | null>;
  readRepoSkill(slug: string): Promise<string | null>;
  validate(md: string): { ok: boolean; errors: string[] };
  enqueue(task: ReinjectTask): Promise<{ added: string[]; skipped: string[] }>;
  onEnqueued?(task: ReinjectTask): void;
}

export function backlogSkillsApplier(deps: SkillsApplierDeps): (
  changes: ProposedChange[],
) => Promise<{
  enqueued: string[];
  skipped: string[];
  rejected: Array<{ slug: string; reason: string }>;
  warned: Array<{ slug: string; reasons: string[] }>;
}> {
  return async (changes) => {
    const enqueued: string[] = [];
    const skipped: string[] = [];
    const rejected: Array<{ slug: string; reason: string }> = [];
    const warned: Array<{ slug: string; reasons: string[] }> = [];
    for (const change of changes) {
      const slug = change.text.trim();
      if (!SKILL_SLUG_RE.test(slug)) {
        rejected.push({ slug, reason: "技能 slug 格式非法" });
        continue;
      }
      try {
        const draft = await deps.readDraft(slug);
        if (draft === null) {
          rejected.push({ slug, reason: "草稿不存在" });
          continue;
        }
        const validation = deps.validate(draft);
        if (!validation.ok) {
          rejected.push({ slug, reason: validation.errors.join("；") });
          continue;
        }
        // 技能安全扫描：高危指令硬拦；讨论性命中只提示（Skill Misevolution，C6）。
        const safety = scanSkillSafety(draft);
        if (!safety.safe) {
          rejected.push({ slug, reason: `技能安全扫描未通过：${safety.block.join("、")}` });
          continue;
        }
        if (safety.warn.length > 0) warned.push({ slug, reasons: safety.warn });
        if (await deps.readRepoSkill(slug) === draft) {
          skipped.push(slug);
          continue;
        }
        const task = skillsBacklogTask(slug, draft);
        await deps.enqueue(task);
        deps.onEnqueued?.(task);
        enqueued.push(slug);
      } catch (error) {
        rejected.push({ slug, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { enqueued, skipped, rejected, warned };
  };
}
