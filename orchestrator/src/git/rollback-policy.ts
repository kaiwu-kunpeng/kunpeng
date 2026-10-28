export interface RollbackPolicy {
  removeWorktree: boolean;
  deleteBranch: boolean;
  reason: string;
}

export function rollbackPolicy(envValue: string | undefined): RollbackPolicy {
  if (envValue === "1") {
    return { removeWorktree: false, deleteBranch: false, reason: "kept-by-env" };
  }
  return { removeWorktree: true, deleteBranch: true, reason: "cleaned" };
}
