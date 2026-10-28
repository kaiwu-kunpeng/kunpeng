import { readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, join } from "node:path";
import { parseSkillFrontmatter } from "./skill-md.js";

export interface ImportCandidate {
  dir: string;
  name: string;
  description: string;
}

export function scanSkillDirs(rootDir: string, maxDepth = 3): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const depthLimit = Number.isFinite(maxDepth) ? Math.floor(maxDepth) : 3;

  if (depthLimit < 0) return candidates;

  function visit(dir: string, depth: number): void {
    if (depth > depthLimit) return;

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.name === "SKILL.md")) {
      try {
        const frontmatter = parseSkillFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
        candidates.push({
          dir,
          name: frontmatter.name ?? basename(dir),
          description: frontmatter.description ?? "",
        });
      } catch {
        // A broken skill file must not prevent sibling directories from being scanned.
      }
    }

    if (depth === depthLimit) return;

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      visit(join(dir, entry.name), depth + 1);
    }
  }

  visit(rootDir, 0);
  return candidates;
}

export async function importSkills(
  candidates: ImportCandidate[],
  deps: {
    register: (candidate: ImportCandidate) => Promise<void> | void;
    exists: (name: string) => boolean;
  },
): Promise<{ imported: string[]; skipped: string[] }> {
  const imported: string[] = [];
  const skipped: string[] = [];
  const skippedNames = new Set<string>();

  const skip = (name: string): void => {
    if (skippedNames.has(name)) return;
    skippedNames.add(name);
    skipped.push(name);
  };

  for (const candidate of candidates) {
    try {
      if (deps.exists(candidate.name)) {
        skip(candidate.name);
        continue;
      }
      await deps.register(candidate);
      imported.push(candidate.name);
    } catch {
      skip(candidate.name);
    }
  }

  return { imported, skipped };
}
