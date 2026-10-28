import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

export const PLAYBOOK_SECTIONS = ["检查节奏", "何时行动", "动手前自检", "状态与幂等", "止损与上报", "产出落位"] as const;
export const PLAYBOOK_PHASES = ["research", "create", "distribute", "measure", "evolve"] as const;

export interface PlaybookDef {
  id: string;
  title: string;
  phase?: (typeof PLAYBOOK_PHASES)[number];
  projectId?: string;
  recipe?: string;
  skills?: string[];
  loopId?: string;
  metricCmd?: string;
  cadence?: string;
  gate?: "auto" | "review";
  pilot?: boolean;
  conversionGoal?: { key: string; label: string };
  sections: Record<string, string>;
  body: string;
}

type Frontmatter = Record<string, string>;

export function parsePlaybook(md: string, fallbackId = ""): PlaybookDef | null {
  if (md.trim().length === 0) return null;

  const { frontmatter, body } = splitFrontmatter(md);
  const id = frontmatter.id?.trim() || fallbackId;
  const title = findTitle(body) || id;
  const phase = PLAYBOOK_PHASES.find((p) => p === frontmatter.phase?.trim());
  const gate = frontmatter.gate === "auto" ? "auto" : "review";
  const conversionGoal = parseConversionGoal(frontmatter.conversionGoal);
  const skills = parseSkillsList(frontmatter.skills);

  return {
    id,
    title,
    phase,
    projectId: optionalValue(frontmatter.projectId),
    recipe: optionalValue(frontmatter.recipe),
    ...(skills ? { skills } : {}),
    loopId: optionalValue(frontmatter.loopId),
    metricCmd: optionalValue(frontmatter.metricCmd),
    cadence: optionalValue(frontmatter.cadence),
    gate,
    ...(frontmatter.pilot === "true" ? { pilot: true } : {}),
    conversionGoal,
    sections: parseSections(body),
    body,
  };
}

export async function listPlaybooks(repoRoot: string): Promise<PlaybookDef[]> {
  const dir = join(repoRoot, ".kunpeng", "playbooks");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const playbooks = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map(async (file) => {
        try {
          const raw = await readFile(join(dir, file), "utf8");
          return parsePlaybook(raw, parse(file).name);
        } catch {
          return null;
        }
      }),
  );

  return playbooks.filter((playbook): playbook is PlaybookDef => playbook !== null).sort((a, b) => a.id.localeCompare(b.id));
}

export function parseSkillsList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(/[\s,、]+/).map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function splitFrontmatter(md: string): { frontmatter: Frontmatter; body: string } {
  const normalized = md.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: md };
  }

  const firstLineEnd = normalized.indexOf("\n");
  if (firstLineEnd === -1 || normalized.slice(0, firstLineEnd).trim() !== "---") {
    return { frontmatter: {}, body: md };
  }

  const close = findClosingFence(normalized, firstLineEnd + 1);
  if (close === null) {
    return { frontmatter: {}, body: md };
  }

  const rawFrontmatter = normalized.slice(firstLineEnd + 1, close.start);
  const body = normalized.slice(close.end);
  return { frontmatter: parseFrontmatter(rawFrontmatter), body };
}

function findClosingFence(md: string, from: number): { start: number; end: number } | null {
  let lineStart = from;
  while (lineStart <= md.length) {
    const lineEnd = md.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? md.length : lineEnd;
    if (md.slice(lineStart, end).trim() === "---") {
      return { start: lineStart, end: lineEnd === -1 ? end : lineEnd + 1 };
    }
    if (lineEnd === -1) return null;
    lineStart = lineEnd + 1;
  }
  return null;
}

function parseFrontmatter(raw: string): Frontmatter {
  const frontmatter: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const delimiter = line.indexOf(":");
    if (delimiter === -1) continue;

    const key = line.slice(0, delimiter).trim();
    if (key.length === 0) continue;
    frontmatter[key] = line.slice(delimiter + 1).trim();
  }
  return frontmatter;
}

function findTitle(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

function parseConversionGoal(raw: string | undefined): { key: string; label: string } | undefined {
  if (!raw) return undefined;
  const delimiter = raw.indexOf("|");
  if (delimiter === -1) return undefined;

  const key = raw.slice(0, delimiter).trim();
  const label = raw.slice(delimiter + 1).trim();
  if (key.length === 0 || label.length === 0) return undefined;
  return { key, label };
}

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | undefined;
  let collected: string[] = [];

  const saveCurrent = (): void => {
    if (current) {
      sections[current] = collected.join("\n").trim();
    }
  };

  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      saveCurrent();
      const title = heading[1].trim();
      current = PLAYBOOK_SECTIONS.find((section) => title.startsWith(section));
      collected = [];
      continue;
    }

    if (current) collected.push(line);
  }

  saveCurrent();
  return sections;
}

function optionalValue(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value && value.length > 0 ? value : undefined;
}
