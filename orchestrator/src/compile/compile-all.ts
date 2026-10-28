import { stat } from "node:fs/promises";
import { compileAgentsMd } from "./agents-md.js";
import { join } from "node:path";

export interface ProjectLike { id: string; repoPath: string; }
export interface CompileAllItem {
  id: string;
  repoPath: string;
  path?: string;
  clobberAvoided?: boolean;
  error?: string;
}

export async function compileAll(
  kunpengRoot: string,
  projects: ProjectLike[],
): Promise<CompileAllItem[]> {
  const results: CompileAllItem[] = [];

  for (const project of projects) {
    try {
      const repoStat = await stat(project.repoPath);
      if (!repoStat.isDirectory()) {
        throw new Error(`repoPath is not a directory: ${project.repoPath}`);
      }
      const compiled = await compileAgentsMd({
        kunpengRoot,
        outFile: join(project.repoPath, "AGENTS.md"),
      });
      results.push({
        id: project.id,
        repoPath: project.repoPath,
        path: compiled.path,
        clobberAvoided: compiled.clobberAvoided,
      });
    } catch (error) {
      results.push({
        id: project.id,
        repoPath: project.repoPath,
        error: String(error),
      });
    }
  }

  return results;
}
