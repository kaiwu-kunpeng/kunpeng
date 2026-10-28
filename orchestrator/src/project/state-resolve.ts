import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import type { ProjectEntry } from "./registry.js";
import { kunpengStateDir } from "./registry.js";

export interface ResolveStateDeps {
  stateDir?: string;
  runGit?: (repoRoot: string) => string | null;
  readRegistrySync?: (stateDir: string) => ProjectEntry[];
}

function defaultRunGit(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], { encoding: "utf8", timeout: 5_000 }).trim();
  } catch {
    return null;
  }
}

function defaultReadSync(stateDir: string): ProjectEntry[] {
  try {
    return JSON.parse(readFileSync(join(stateDir, "projects.json"), "utf8")).projects;
  } catch {
    return [];
  }
}

export function canonicalRepoRoot(repoRoot: string, deps?: ResolveStateDeps): string {
  try {
    let commonDir: string | null;
    try {
      commonDir = (deps?.runGit ?? defaultRunGit)(repoRoot);
    } catch {
      return repoRoot;
    }
    if (!commonDir) return repoRoot;
    const absoluteCommonDir = resolve(repoRoot, commonDir);
    if (basename(absoluteCommonDir) === ".git") return dirname(absoluteCommonDir);
    return repoRoot;
  } catch {
    return repoRoot;
  }
}

export function resolveProjectStateDir(repoRoot: string, deps?: ResolveStateDeps): string {
  try {
    const canonical = canonicalRepoRoot(repoRoot, deps);
    const reg = (deps?.readRegistrySync ?? defaultReadSync)(deps?.stateDir ?? kunpengStateDir());
    const match = reg.find((p) => p.repoPath === canonical) ?? reg.find((p) => p.repoPath === repoRoot);
    const root = match ? match.repoPath : repoRoot;
    return join(root, ".kunpeng", "state");
  } catch {
    return join(repoRoot, ".kunpeng", "state");
  }
}
