import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, isAbsolute, parse as parsePath, resolve } from "node:path";

export interface InferredProject {
  id: string;
  name: string;
  repoPath: string;
}

export interface InferDeps {
  readSelf?: (dir: string) => { id: string; name?: string } | null;
  registryEntries?: () => { id: string; name?: string; repoPath: string }[];
  gitCommonRoot?: (cwd: string) => string | null;
}

function defaultReadSelf(dir: string): { id: string; name?: string } | null {
  const file = join(dir, ".kunpeng", "project.json");
  if (!existsSync(file)) return null;

  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as { id?: unknown }).id === "string" &&
      (
        (data as { name?: unknown }).name === undefined ||
        typeof (data as { name?: unknown }).name === "string"
      )
    ) {
      return {
        id: (data as { id: string }).id,
        name: (data as { name?: string }).name,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function defaultRegistryEntries(): { id: string; name?: string; repoPath: string }[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const stateDir = process.env.KUNPENG_STATE ?? join(home, ".kunpeng");
  const file = join(stateDir, "projects.json");
  if (!existsSync(file)) return [];

  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof data !== "object" || data === null || !Array.isArray((data as { projects?: unknown }).projects)) {
      return [];
    }

    return (data as { projects: unknown[] }).projects.flatMap((entry) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string" &&
        typeof (entry as { repoPath?: unknown }).repoPath === "string" &&
        (
          (entry as { name?: unknown }).name === undefined ||
          typeof (entry as { name?: unknown }).name === "string"
        )
      ) {
        return [{
          id: (entry as { id: string }).id,
          name: (entry as { name?: string }).name,
          repoPath: (entry as { repoPath: string }).repoPath,
        }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function defaultGitCommonRoot(cwd: string): string | null {
  try {
    const output = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--git-common-dir"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      },
    ).trim();

    if (!output) return null;
    const commonDir = isAbsolute(output) ? output : resolve(cwd, output);
    return commonDir.endsWith(".git") ? dirname(commonDir) : commonDir;
  } catch {
    return null;
  }
}

function isPathWithin(cwd: string, repoPath: string): boolean {
  const cleanRepo = repoPath.replace(/\/+$/, "");
  const cleanCwd = cwd.replace(/\/+$/, "");
  return cleanCwd === cleanRepo || cleanCwd.startsWith(`${cleanRepo}/`);
}

export function inferProjectFromPath(cwd: string, deps?: InferDeps): InferredProject | null {
  const readSelf = deps?.readSelf ?? defaultReadSelf;
  let dir = cwd;
  const root = parsePath(dir).root;

  while (true) {
    const self = readSelf(dir);
    if (self) {
      return { id: self.id, name: self.name ?? self.id, repoPath: dir };
    }

    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const registryEntries = deps?.registryEntries ?? defaultRegistryEntries;
  const matched = registryEntries()
    .filter((entry) => isPathWithin(cwd, entry.repoPath))
    .sort((a, b) => b.repoPath.length - a.repoPath.length)[0];

  if (matched) {
    return { id: matched.id, name: matched.name ?? matched.id, repoPath: matched.repoPath };
  }

  const gitCommonRoot = deps?.gitCommonRoot ?? defaultGitCommonRoot;
  let commonRoot: string | null;
  try {
    commonRoot = gitCommonRoot(cwd);
  } catch {
    return null;
  }

  if (!commonRoot || commonRoot === cwd) return null;

  dir = commonRoot;
  const commonPathRoot = parsePath(dir).root;
  while (true) {
    const self = readSelf(dir);
    if (self) {
      return { id: self.id, name: self.name ?? self.id, repoPath: dir };
    }

    if (dir === commonPathRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const commonRootMatched = registryEntries()
    .filter((entry) => isPathWithin(commonRoot, entry.repoPath))
    .sort((a, b) => b.repoPath.length - a.repoPath.length)[0];

  if (!commonRootMatched) return null;
  return {
    id: commonRootMatched.id,
    name: commonRootMatched.name ?? commonRootMatched.id,
    repoPath: commonRootMatched.repoPath,
  };
}
