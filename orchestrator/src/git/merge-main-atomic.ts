import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { gitWithWallClock } from "./git-wall.js";

export interface AtomicMergeResult {
  ok: boolean;
  raced?: boolean;
  conflict?: boolean;
  merged?: string;
  error?: string;
}

export async function mergeIntoMainAtomic(
  repoRoot: string,
  branch: string,
  main = "main",
  opts?: { expectedHead?: string },
): Promise<AtomicMergeResult> {
  const g = gitWithWallClock(repoRoot);
  const before = (
    opts?.expectedHead ?? (await g.revparse([`refs/heads/${main}`]).catch(() => ""))
  ).trim();
  if (!before) return { ok: false, error: `读不到 ${main} HEAD` };

  const branchSha = (await g.raw(["rev-parse", "--verify", "--quiet", branch]).catch(() => "")).trim();
  if (!branchSha) return { ok: false, error: `分支 ${branch} 不存在` };

  const tmp = join(repoRoot, ".kunpeng", `merge-atomic-tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
  await g.raw(["worktree", "prune"]).catch(() => {});

  try {
    await g.raw(["worktree", "add", "--detach", tmp, before]);
    const wt = gitWithWallClock(tmp);
    let merged: string;

    try {
      await wt.merge(["--no-ff", branch]);
      merged = (await wt.revparse(["HEAD"])).trim();
    } catch {
      await wt.merge(["--abort"]).catch(() => {});
      await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
      return { ok: false, conflict: true };
    }

    try {
      await g.raw(["update-ref", `refs/heads/${main}`, merged, before]);
    } catch {
      await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
      return { ok: false, raced: true };
    }

    await g.raw(["worktree", "remove", "--force", tmp]);
    return { ok: true, merged };
  } catch (e) {
    await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
    return { ok: false, error: String(e) };
  }
}
