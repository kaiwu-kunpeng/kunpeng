/** 合并实际删除的文件 减去 分支有意删除的文件 = 陈旧基底导致的「误删」。非空表示该合并不该放行。 */
export function staleDeletions(mergeDeleted: string[], branchIntentionalDeletions: string[]): string[] {
  const intended = new Set(branchIntentionalDeletions);
  return mergeDeleted.filter((file) => !intended.has(file));
}

/** 注入式 git 读口（只读）：diffNames 跑 `git diff <args>` 取 name-only 列表;mergeBase 取两 ref 的合并基。 */
export interface GuardGit {
  diffNames(args: string[]): Promise<string[]>;
  mergeBase(a: string, b: string): Promise<string>;
}

/**
 * 合并完成后调用。beforeSha=合并前 base 的 HEAD;afterSha=合并后 HEAD;branch=被合并的分支(如 kp/<flowId>)。
 * 返回「被合并静默删除、且非分支有意删除」的文件列表(空=安全;非空=调用方应回退到 beforeSha 并拒绝合并)。
 * 先看合并删了啥(beforeSha..afterSha 的 D);无删除则直接 [];有则减去分支自身(forkPoint..branch 的 D)的有意删除。
 */
export async function findStaleDeletions(
  git: GuardGit,
  beforeSha: string,
  afterSha: string,
  branch: string,
): Promise<string[]> {
  const mergeDeleted = await git.diffNames(["--no-renames", "--diff-filter=D", "--name-only", `${beforeSha}..${afterSha}`]);
  if (mergeDeleted.length === 0) return [];
  const forkPoint = await git.mergeBase(beforeSha, branch);
  const branchDeleted = await git.diffNames(["--no-renames", "--diff-filter=D", "--name-only", `${forkPoint}..${branch}`]);
  return staleDeletions(mergeDeleted, branchDeleted);
}
