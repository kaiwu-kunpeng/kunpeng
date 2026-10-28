export interface GateFutilityGit {
  branchExists(branch: string): Promise<boolean>;
  mergeDiffEmpty(branch: string, base: string): Promise<boolean>;
}

export interface FutilityVerdict {
  futile: boolean;
  reason?: string;
}

export async function classifyGateFutility(
  git: GateFutilityGit,
  flowId: string,
  base = "main",
): Promise<FutilityVerdict> {
  const branch = "kp/" + flowId;

  if (!(await git.branchExists(branch))) {
    return { futile: true, reason: "流分支 " + branch + " 已不存在，无可合并内容" };
  }

  if (await git.mergeDiffEmpty(branch, base)) {
    return { futile: true, reason: "相对 " + base + " 无实际改动（空提交），合并审查必拒" };
  }

  return { futile: false };
}
