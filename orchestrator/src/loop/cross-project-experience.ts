import { join } from "node:path";
import type { Artifact } from "../artifacts/types.js";

export interface CrossProjectRef { id: string; repoPath: string; }
export interface ExperienceLister { list(kind: "experience"): Promise<Artifact[]>; }

export async function gatherCrossProjectExperiences(
  projects: CrossProjectRef[],
  selfRepoPath: string,
  makeLister: (artifactsDir: string) => ExperienceLister,
): Promise<Artifact[]> {
  const seenIds = new Set<string>();
  const experiences: Artifact[] = [];

  for (const project of projects) {
    if (project.repoPath === selfRepoPath) {
      continue;
    }

    try {
      const artifactsDir = join(project.repoPath, ".kunpeng", "artifacts");
      const lister = makeLister(artifactsDir);
      const projectExperiences = await lister.list("experience");

      for (const artifact of projectExperiences) {
        if (seenIds.has(artifact.id)) {
          continue;
        }

        seenIds.add(artifact.id);
        experiences.push(artifact);
      }
    } catch {
      continue;
    }
  }

  return experiences;
}
