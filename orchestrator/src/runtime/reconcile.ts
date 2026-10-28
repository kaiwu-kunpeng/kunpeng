import os from "node:os";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type SimpleGit } from "simple-git";
import { gitWithWallClock } from "../git/git-wall.js";
import { isProcessAlive } from "../util/liveness.js";
import { killProcessTree } from "../agent/cli-stream.js";
import { FlowTracker, type HumanGate } from "./flowstate.js";
import { leaseAgeMs, leaseExpired } from "./lease-policy.js";

export interface ReconcileDeadFlowsResult {
  reconciled: string[];
}

export interface ReconcileStaleResult {
  cleared: string[];
}

export interface ReconcileGhostsResult {
  retired: string[];
}

export function startPeriodicReconcile(run: () => Promise<void>, intervalMs = 600_000): () => void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void Promise.resolve()
      .then(run)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

export async function reconcileDeadFlows(
  tracker: FlowTracker,
  opts: {
    isAlive?: (pid: number) => boolean;
    now?: () => number;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
  } = {}
): Promise<ReconcileDeadFlowsResult> {
  const isAlive = opts.isAlive ?? isProcessAlive;
  const now = opts.now ?? Date.now;
  const kill = opts.kill ?? ((pid, signal) => killProcessTree(pid, signal));
  const host = os.hostname();
  const reconciled: string[] = [];

  for (const flow of await tracker.list()) {
    if (flow.status !== "running") continue;
    if (flow.host && flow.host !== host) continue;
    if (flow.lease) {
      const at = now();
      const lease = flow.lease;
      if (!leaseExpired(lease, at)) continue;
      const age = leaseAgeMs(lease, at);

      if (flow.pid === undefined || !isAlive(flow.pid)) {
        await tracker.markCrashed(flow.flowId, "lease-expired");
      } else if (!flow.stall) {
        await tracker.markStalled(flow.flowId, {
          detectedAt: at,
          leaseAgeMs: age,
          note: `租约 ${lease.ttlMs}ms 已 ${age}ms 未续，进程 ${flow.pid} 仍在；再过 ${lease.ttlMs}ms 无心跳判死`,
        });
        continue;
      } else if (at - flow.stall.detectedAt > lease.ttlMs) {
        await tracker.markCrashed(flow.flowId, `lease-expired-stuck: 进程 ${flow.pid} 存活但 ${age}ms 无心跳（stall 自 ${flow.stall.detectedAt}）`);
      } else {
        continue;
      }
      if (flow.agentPid !== undefined && isAlive(flow.agentPid)) kill(flow.agentPid, "SIGKILL");
      reconciled.push(flow.flowId);
      continue;
    }

    if (flow.pid === undefined) continue;
    if (isAlive(flow.pid)) continue;

    await tracker.markCrashed(flow.flowId);
    reconciled.push(flow.flowId);
  }

  return { reconciled };
}

export async function reconcileStaleArtifacts(tracker: FlowTracker): Promise<ReconcileStaleResult> {
  const cleared: string[] = [];
  // 只清「经完整开发循环自然收敛」的终态残留：verified（不该有 blocker）、rolled-back（原因已转入 experience）。
  // 刻意**不含** stopped：stopped 是用户在某流仍卡着时主动中止的，其 blocker 是人需要事后复盘的真实原因，
  // 不能静默抹掉（对抗审查发现）。crashed/running 同样绝不动——它们是未解决问题，必须继续暴露。
  const autoClearable = new Set(["verified", "rolled-back"]);

  for (const flow of await tracker.list()) {
    if (!autoClearable.has(flow.status)) continue;
    if (!flow.blocker) continue;

    await tracker.clearBlocker(flow.flowId);
    cleared.push(flow.flowId);
  }

  return { cleared };
}

function isMergeGate(gate: HumanGate): boolean {
  return gate.gate.includes("合并主干") || /^kp\/.+\s+→\s/.test(gate.what);
}

async function branchSubsumed(git: SimpleGit, branch: string): Promise<boolean> {
  try {
    const out = await git.raw(["cherry", "main", branch]);
    // git cherry <upstream> <head>：以 "+" 开头的行=该提交未进 upstream。无任何 "+" 行 → 已被 main 完全吸收。
    return !out.split("\n").some((line) => line.startsWith("+"));
  } catch {
    return false; // 判不了就保守不清(留门)
  }
}

export async function reconcileGhostMergeGates(repoRoot: string): Promise<{ cleared: string[] }> {
  const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
  const flows = await tracker.list();
  const git = gitWithWallClock(repoRoot);

  let branches: Set<string>;
  try {
    branches = new Set((await git.branchLocal()).all);
  } catch {
    return { cleared: [] };
  }

  const cleared: string[] = [];
  for (const flow of flows) {
    if (!flow.humanGate) continue;
    if (!isMergeGate(flow.humanGate)) continue;
    const branchName = `kp/${flow.flowId}`;
    if (branches.has(branchName) && !(await branchSubsumed(git, branchName))) continue;

    await tracker.clearGate(flow.flowId, { by: "machine", via: "reconcile-ghost" });
    cleared.push(flow.flowId);
  }

  return { cleared };
}

export async function reconcileSupersededGhosts(
  tracker: FlowTracker,
  repoRoot: string,
  opts: {
    isSubsumed?: (branch: string) => Promise<boolean>;
    hasBranch?: (branch: string) => Promise<boolean>;
  } = {}
): Promise<ReconcileGhostsResult> {
  const git = gitWithWallClock(repoRoot);
  let branches: Set<string> | undefined;
  const hasBranch =
    opts.hasBranch ??
    (async (branch: string) => {
      try {
        branches ??= new Set((await git.branchLocal()).all);
      } catch {
        return true; // 判不定时保守留红，避免把真实 crashed 静默退役。
      }
      return branches.has(branch);
    });
  const isSubsumed = opts.isSubsumed ?? ((branch: string) => branchSubsumed(git, branch));
  const retired: string[] = [];

  for (const flow of await tracker.list()) {
    if (flow.status !== "crashed") continue;

    const branch = `kp/${flow.flowId}`;
    let branchExists: boolean;
    try {
      branchExists = await hasBranch(branch);
    } catch {
      continue;
    }

    let superseded = !branchExists;
    if (branchExists) {
      try {
        superseded = await isSubsumed(branch);
      } catch {
        superseded = false;
      }
    }
    if (!superseded) continue;

    let applied = false;
    const out = await tracker.mutate(flow.flowId, (s) => {
      applied = false;
      if (s.status !== "crashed") return false;
      const retiredAt = Date.now();
      s.stage = "done";
      s.status = "rolled-back";
      s.agentActive = false;
      if (s.failureReason === undefined) {
        s.failureReason = s.blocker?.trim()
          ? `[retired-superseded] 崩溃流分支 kp/${s.flowId} 已被主干吸收或已不存在，自动退役；崩溃时卡点：${s.blocker}`
          : `[retired-superseded] 崩溃流分支 kp/${s.flowId} 已被主干吸收或已不存在，自动退役`;
      }
      delete s.blocker;
      s.updatedAt = retiredAt;
      s.history.push({ stage: "retired-superseded", at: retiredAt });
      applied = true;
    });
    if (out !== null && applied) retired.push(flow.flowId);
  }

  return { retired };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function reconcileOrphanWorktrees(repoRoot: string): Promise<{ pruned: string[] }> {
  const git = gitWithWallClock(repoRoot);
  await git.raw(["worktree", "prune"]).catch(() => {});

  const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
  const flows = await tracker.list();

  let branches: Set<string>;
  try {
    branches = new Set((await git.branchLocal()).all);
  } catch {
    return { pruned: [] };
  }

  const pruned: string[] = [];
  for (const flow of flows) {
    if (!flow.planId) continue;
    if (flow.status === "running") continue;

    const flowBranch = `kp/${flow.flowId}`;
    const planBranch = `kp/${flow.planId}`;
    if (!branches.has(flowBranch)) continue;
    if (branches.has(planBranch)) continue;

    const worktreePath = join(repoRoot, ".kunpeng", "wt", flow.flowId);
    if (await pathExists(worktreePath)) {
      await git.raw(["worktree", "remove", "--force", worktreePath]).catch(() => {});
      await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    }
    await git.raw(["branch", "-D", flowBranch]).catch(() => {});
    pruned.push(flow.flowId);
  }

  return { pruned };
}

/** Best-effort startup reconcile across registered repos. Broken registry entries never block serve startup. */
export async function reconcileReposBestEffort(repoPaths: string[]): Promise<void> {
  for (const repoPath of repoPaths) {
    try {
      const tracker = new FlowTracker(resolveProjectStateDir(repoPath));
      await reconcileDeadFlows(tracker);
      await reconcileSupersededGhosts(tracker, repoPath).catch(() => {});
      await reconcileGhostMergeGates(repoPath).catch(() => {});
      await reconcileOrphanWorktrees(repoPath).catch(() => {});
    } catch {
      // best-effort only
    }
  }
}
