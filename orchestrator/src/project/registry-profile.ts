import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ProfileProjectEntry {
  id: string;
  name: string;
  repoPath: string;
  registeredAt: number;
}

function isProfileProjectEntry(value: unknown): value is ProfileProjectEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProfileProjectEntry).id === "string" &&
    typeof (value as ProfileProjectEntry).name === "string" &&
    typeof (value as ProfileProjectEntry).repoPath === "string" &&
    typeof (value as ProfileProjectEntry).registeredAt === "number"
  );
}

export function readProfileRegistry(
  projectsPath: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): ProfileProjectEntry[] {
  try {
    const data = JSON.parse(read(projectsPath));
    return Array.isArray(data.projects) ? data.projects.filter(isProfileProjectEntry) : [];
  } catch {
    return [];
  }
}

export function writeProfileRegistry(projectsPath: string, projects: ProfileProjectEntry[]): void {
  mkdirSync(dirname(projectsPath), { recursive: true });
  const tmp = `${projectsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), "utf8");
  renameSync(tmp, projectsPath);
}

export function isProjectInProfile(projectId: string, projects: ProfileProjectEntry[]): boolean {
  return projects.some((project) => project.id === projectId);
}

export function assertProjectInProfile(projectId: string, projects: ProfileProjectEntry[]): void {
  if (!isProjectInProfile(projectId, projects)) {
    throw new Error(`FORBIDDEN_PROJECT:${projectId}`);
  }
}
