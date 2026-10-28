import matter from "gray-matter";
import type { Artifact } from "../artifacts/types.js";

export interface SkillDocOpts {
  name: string;
  description: string;
}

const MAX_ITEM_LENGTH = 200;

function firstNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function truncate(value: string): string {
  if (value.length <= MAX_ITEM_LENGTH) return value;
  return `${value.slice(0, MAX_ITEM_LENGTH - 1)}…`;
}

function metaOutcome(artifact: Artifact): unknown {
  return artifact.meta?.outcome;
}

function outcomeOf(artifact: Artifact): unknown {
  const outcome = metaOutcome(artifact);
  return outcome === undefined ? artifact.status : outcome;
}

function evidenceOf(artifact: Artifact): string | undefined {
  const evidence = artifact.meta?.evidence;
  if (typeof evidence !== "string") return undefined;
  const firstLine = firstNonEmptyLine(evidence);
  return firstLine.length > 0 ? truncate(firstLine) : undefined;
}

function itemText(artifact: Artifact): string {
  return truncate(firstNonEmptyLine(artifact.body));
}

function verifiedItems(experiences: Artifact[]): string[] {
  return experiences
    .filter((artifact) => outcomeOf(artifact) === "verified")
    .map((artifact) => `- ${itemText(artifact)}`);
}

function rolledBackItems(experiences: Artifact[]): string[] {
  return experiences
    .filter((artifact) => outcomeOf(artifact) === "rolled-back")
    .map((artifact) => {
      const evidence = evidenceOf(artifact);
      const base = `- ${itemText(artifact)}`;
      return evidence ? `${base} 证据：${evidence}` : base;
    });
}

function renderList(items: string[], emptyText: string): string {
  return items.length > 0 ? items.join("\n") : emptyText;
}

export function buildSkillDoc(experiences: Artifact[], opts: SkillDocOpts): string {
  const body = [
    `# ${opts.name}`,
    "",
    "## 何时用",
    opts.description,
    "",
    "## 经验要点",
    renderList(verifiedItems(experiences), "（暂无已验证经验）"),
    "",
    "## 失败蒸馏",
    renderList(rolledBackItems(experiences), "（暂无失败经验）"),
    "",
    `本技能由 ${experiences.length} 条经验蒸馏`,
  ].join("\n");

  return matter.stringify(body, {
    name: opts.name,
    description: opts.description,
  });
}
