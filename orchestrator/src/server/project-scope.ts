import { basename, join } from "node:path";
import { readProfileRegistry } from "../project/registry-profile.js";
import { readRegistry, kunpengStateDir, type ProjectEntry } from "../project/registry.js";
import { currentProfileId } from "./auth-context.js";

export function profileProjects(profileId: string, stateDir?: string): ProjectEntry[] {
  return readProfileRegistry(join(stateDir ?? kunpengStateDir(), "profiles", profileId, "projects.json"));
}

export async function gateProjects(opts: { repoRoot?: string; stateDir?: string }): Promise<string[]> {
  if (opts.repoRoot) return [opts.repoRoot];
  const profileId = currentProfileId();
  if (profileId) return profileProjects(profileId, opts.stateDir).map((p) => p.repoPath);
  return (await readRegistry(opts.stateDir ?? "").catch(() => [])).map((p) => p.repoPath);
}

export async function registeredProjects(opts: { repoRoot?: string; stateDir?: string }): Promise<ProjectEntry[]> {
  if (opts.repoRoot) {
    const name = basename(opts.repoRoot);
    return [{ id: name, name, repoPath: opts.repoRoot, registeredAt: 0 }];
  }
  const profileId = currentProfileId();
  if (profileId) return profileProjects(profileId, opts.stateDir);
  return readRegistry(opts.stateDir ?? "");
}

export async function resolveRepo(
  opts: { repoRoot?: string; stateDir?: string },
  projectId: string,
): Promise<string | null> {
  if (opts.repoRoot) return opts.repoRoot;
  return (await registeredProjects(opts)).find((project) => project.id === projectId)?.repoPath ?? null;
}
