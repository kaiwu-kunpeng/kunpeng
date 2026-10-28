import { listSkills, setSkillFields, type SkillCategory } from "./registry.js";

export interface CategoryCandidate {
  name: string;
  description: string;
  tags?: string[];
  dir: string;
}

const CATEGORY_RULES: ReadonlyArray<readonly [SkillCategory, readonly string[]]> = [
  ["agent-internal", ["agent-only"]],
  ["growth", ["geo", "seo", "marketing", "growth", "content", "copywriting", "cro", "conversion", "paid-ads"]],
  ["docs", ["docx", "pdf", "pptx", "xlsx", "canvas", "artifact", "powerpoint", "spreadsheet", "presentation", "writing", "deck", "doc-coauthoring"]],
  ["git", ["git", "github", "commit", "changelog", "pull request", "rebase", "revert", "merge-conflict", "merge conflict", "branch", "triage"]],
  ["design", ["design", "ui", "frontend", "a11y", "accessibility", "prototype", "brand", "theme"]],
  ["thinking", ["thinking", "brainstorm", "grill", "teach", "reasoning", "ideation"]],
  ["strategy", ["strategy", "report", "research", "competitor", "pricing", "monetization", "market"]],
  ["build", ["tdd", "test-driven", "implement", "build", "coding", "codebase", "contract-test", "migration", "spec", "plan", "mcp", "react", "next", "prisma", "typescript", "structured-output", "webapp-testing"]],
  ["review", ["review", "debug", "audit", "verify", "verification", "validation", "coverage", "flaky", "security", "authz", "owasp", "dead-code", "simplify", "schema-diff", "read-the-trace", "failing-test"]],
];

export function guessCategory(candidate: CategoryCandidate): SkillCategory {
  const searchable = [
    candidate.name,
    candidate.description,
    ...(candidate.tags ?? []),
    candidate.dir,
  ].join(" ").toLowerCase();

  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => searchable.includes(keyword))) return category;
  }
  return "agent-internal";
}

export function categorizeAll(root: string): { updated: number } {
  let updated = 0;
  for (const skill of listSkills(root)) {
    if (skill.category !== undefined) continue;
    setSkillFields(root, skill.id, {
      category: guessCategory({
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        dir: skill.dir,
      }),
    });
    updated += 1;
  }
  return { updated };
}
