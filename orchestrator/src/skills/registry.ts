import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";
import { parseSkillFrontmatter } from "./skill-md.js";

export interface SkillUpstream {
  url: string;
  commit?: string;
  sha256?: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  origin: "authored" | "distilled" | "vendored";
  layer?: "base" | "domain" | "meta";
  tags?: string[];
  version?: string;
  license?: string;
  upstream?: SkillUpstream;
  trustTier?: 0 | 1 | 2;
  allowedTools?: string[];
  triggers?: string[];
  implicitInvocation?: boolean;
  requiresMcp?: string[];
  dir: string;
  registeredAt: string;
  category?: SkillCategory;
  lifecycle?: SkillLifecycle;
  enabled?: boolean;
  appliesTo?: SkillScope;
  usage?: SkillUsage;
}

export type SkillCategory =
  | "engineering-method"
  | "tech-stack"
  | "artifact-gen"
  | "design-ui"
  | "growth-ops"
  | "kunpeng-internal"
  | "strategy-doc"
  | "strategy"
  | "growth"
  | "docs"
  | "design"
  | "build"
  | "review"
  | "git"
  | "thinking"
  | "agent-internal";

export const SKILL_CATEGORIES: readonly SkillCategory[] = [
  "engineering-method",
  "tech-stack",
  "artifact-gen",
  "design-ui",
  "growth-ops",
  "kunpeng-internal",
  "strategy-doc",
  "strategy",
  "growth",
  "docs",
  "design",
  "build",
  "review",
  "git",
  "thinking",
  "agent-internal",
];

export type SkillLifecycle = "incubating" | "active" | "deprecated";

export interface SkillScope {
  projects?: string[];
  stages?: string[];
}

export interface SkillUsage {
  activations: number;
  lastHitAt?: string;
  wins?: number;
  losses?: number;
  lastOutcomeAt?: number;
}

export interface SkillOutcomeResult {
  skill: SkillEntry;
  newlyDeprecated: boolean;
}

export type SkillFieldPatch = Partial<Pick<SkillEntry, "category" | "lifecycle" | "enabled" | "appliesTo">>;

export interface SkillSearchFilter {
  category?: SkillCategory;
  enabled?: boolean;
  project?: string;
  stage?: string;
}

export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(kunpengStateDir(env), "skills");
}

export function registerSkill(root: string, entry: Omit<SkillEntry, "registeredAt">): SkillEntry {
  const skillMd = join(entry.dir, "SKILL.md");
  if (!existsSync(skillMd)) {
    throw new Error(`技能目录缺少 SKILL.md: ${skillMd}`);
  }

  const frontmatter = parseSkillFrontmatter(readFileSync(skillMd, "utf8"));
  const triggers = frontmatter?.triggers;

  const registered: SkillEntry = {
    ...entry,
    ...(Array.isArray(triggers) && triggers.every((trigger) => typeof trigger === "string") ? { triggers } : {}),
    lifecycle: entry.lifecycle ?? "active",
    enabled: entry.enabled ?? true,
    registeredAt: new Date().toISOString(),
  };
  const skills = readIndex(root);
  const existing = skills.findIndex((skill) => skill.id === entry.id);
  if (existing >= 0) {
    skills[existing] = registered;
  } else {
    skills.push(registered);
  }
  writeIndex(root, skills);
  return registered;
}

export function listSkills(root: string): SkillEntry[] {
  return readIndex(root);
}

/** 缺省即视为允许隐式调用;只有显式声明 implicitInvocation === false 才禁止。 */
export function allowsImplicitInvocation(entry: SkillEntry): boolean {
  return entry.implicitInvocation !== false;
}

export function findSkills(root: string, query: string): SkillEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  return readIndex(root)
    .map((skill) => ({ skill, score: scoreSkill(skill, terms) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((match) => match.skill);
}

export function setSkillFields(root: string, id: string, patch: SkillFieldPatch): SkillEntry {
  const allowed = new Set(["category", "lifecycle", "enabled", "appliesTo"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(`不支持的技能字段: ${key}`);
    }
  }

  const skills = readIndex(root);
  const index = skills.findIndex((skill) => skill.id === id);
  if (index < 0) {
    throw new Error(`未找到技能: ${id}`);
  }

  const updated = { ...skills[index], ...patch };
  skills[index] = updated;
  writeIndex(root, skills);
  return updated;
}

export function searchSkills(root: string, query: string, filter: SkillSearchFilter = {}): SkillEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return readIndex(root).filter((skill) => {
    if (filter.category !== undefined && skill.category !== filter.category) return false;
    if (filter.enabled !== undefined && skill.enabled !== filter.enabled) return false;
    if (!scopeMatches(skill.appliesTo?.projects, filter.project)) return false;
    if (!scopeMatches(skill.appliesTo?.stages, filter.stage)) return false;
    if (terms.length === 0) return true;

    const searchable = [skill.name, skill.description, ...(skill.tags ?? [])].join(" ").toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function recordSkillActivation(root: string, ids: string[], hitAt = new Date().toISOString()): void {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const skills = readIndex(root);
  let changed = false;
  for (const skill of skills) {
    const increment = counts.get(skill.id);
    if (increment === undefined) continue;
    skill.usage = {
      ...skill.usage,
      activations: (skill.usage?.activations ?? 0) + increment,
      lastHitAt: hitAt,
    };
    changed = true;
  }
  if (changed) writeIndex(root, skills);
}

export function shouldDeprecate(usage: { wins?: number; losses?: number }): boolean {
  const wins = usage.wins ?? 0;
  const losses = usage.losses ?? 0;
  const total = wins + losses;
  return total >= 5 && wins / total < 0.2;
}

export async function recordSkillOutcome(
  root: string,
  name: string,
  outcome: "win" | "loss",
  at: number,
): Promise<SkillOutcomeResult> {
  if (!Number.isFinite(at)) {
    throw new Error(`技能战绩时间必须是有限数字: ${String(at)}`);
  }

  const skills = readIndex(root);
  const matches = skills.filter((skill) => skill.id === name || skill.name === name);
  if (matches.length === 0) {
    throw new Error(`未找到技能: ${name}`);
  }
  if (matches.length > 1) {
    throw new Error(`技能标识不唯一: ${name}`);
  }

  const matched = matches[0];
  const index = skills.findIndex((skill) => skill.id === matched.id);
  const previousUsage = matched.usage;
  const usage: SkillUsage = {
    ...previousUsage,
    activations: previousUsage?.activations ?? 0,
    wins: previousUsage?.wins ?? 0,
    losses: previousUsage?.losses ?? 0,
    lastOutcomeAt: at,
  };
  if (outcome === "win") {
    usage.wins = (usage.wins ?? 0) + 1;
  } else {
    usage.losses = (usage.losses ?? 0) + 1;
  }

  const newlyDeprecated = matched.lifecycle !== "deprecated" && shouldDeprecate(usage);
  const updated: SkillEntry = {
    ...matched,
    usage,
    lifecycle: newlyDeprecated ? "deprecated" : matched.lifecycle,
  };
  skills[index] = updated;
  writeIndex(root, skills);
  return { skill: updated, newlyDeprecated };
}

export function removeSkill(root: string, id: string): boolean {
  const skills = readIndex(root);
  const next = skills.filter((skill) => skill.id !== id);
  if (next.length === skills.length) {
    return false;
  }
  writeIndex(root, next);
  return true;
}

function indexPath(root: string): string {
  return join(root, "index.json");
}

function readIndex(root: string): SkillEntry[] {
  const path = indexPath(root);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new TypeError("expected an array");
    }
    return (parsed as SkillEntry[]).map((skill) => ({
      ...skill,
      lifecycle: skill.lifecycle ?? "active",
      enabled: skill.enabled ?? true,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to read skill index ${path}: ${reason}`);
    return [];
  }
}

function writeIndex(root: string, skills: SkillEntry[]): void {
  mkdirSync(root, { recursive: true });
  const path = indexPath(root);
  const tmp = join(root, `.index.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(skills, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function scoreSkill(skill: SkillEntry, terms: string[]): number {
  const searchable = [
    skill.name,
    skill.description,
    ...(skill.tags ?? []),
  ].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0);
}

function scopeMatches(values: string[] | undefined, requested: string | undefined): boolean {
  if (requested === undefined || values === undefined || values.length === 0) return true;
  return values.includes(requested);
}
