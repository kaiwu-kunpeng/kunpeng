export type GateStatus = "ghost" | "stale-conflict" | "mergeable" | "branch-missing";

export interface GateDiagnosis {
  flowId: string;
  status: GateStatus;
  commitsBehind: number;
  conflictFiles: string[];
}

export interface GateGit {
  branchExists(branch: string): Promise<boolean>;
  unmergedCommits(branch: string, base: string): Promise<number>;
  commitsBehind(branch: string, base: string): Promise<number>;
  mergeConflictFiles(branch: string, base: string): Promise<string[]>;
}

export async function diagnoseGate(
  git: GateGit,
  flowId: string,
  base = "main",
): Promise<GateDiagnosis> {
  const branch = `kp/${flowId}`;

  if (!(await git.branchExists(branch))) {
    return { flowId, status: "branch-missing", commitsBehind: 0, conflictFiles: [] };
  }

  const commitsBehind = await git.commitsBehind(branch, base).catch(() => 0);

  if ((await git.unmergedCommits(branch, base)) === 0) {
    return { flowId, status: "ghost", commitsBehind, conflictFiles: [] };
  }

  const conflictFiles = await git.mergeConflictFiles(branch, base);
  if (conflictFiles.length > 0) {
    return { flowId, status: "stale-conflict", commitsBehind, conflictFiles };
  }

  return { flowId, status: "mergeable", commitsBehind, conflictFiles: [] };
}
