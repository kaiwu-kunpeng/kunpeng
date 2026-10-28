export interface HarnessFlow {
  planId?: string;
  status?: string;
  history?: { stage: string; at?: number }[];
}

export interface HarnessLocks {
  worktree: boolean;
  specGate: boolean;
  humanReview: boolean;
  determinism: boolean;
  count: number;
}

export function harnessLocks(flow: HarnessFlow): HarnessLocks {
  const history = flow.history ?? [];
  const worktree = !!flow.planId;
  const specGate = flow.status === "verified" || history.some((h) => /verify|spec/i.test(h.stage));
  const humanReview = worktree || history.some((h) => /gate|review|blocker/i.test(h.stage));
  const determinism = true;
  const count = [worktree, specGate, humanReview, determinism].filter(Boolean).length;

  return { worktree, specGate, humanReview, determinism, count };
}

export function fullHarnessCount(flows: HarnessFlow[]): number {
  return flows.filter((flow) => harnessLocks(flow).count === 4).length;
}
