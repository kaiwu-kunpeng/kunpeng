import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitWithWallClock } from "./git-wall.js";

const execFileAsync = promisify(execFile);

export interface FreshenResult {
  status: "current" | "freshened" | "conflict" | "error";
  mainHead: string;
  error?: string;
}

/**
 * 合并前刷新：确保 `main` 是 `branch` 的祖先，避免陈旧流分支合回主干时覆盖主干并发改动。
 */
export async function freshenBranchOntoMain(repoRoot: string, branch: string, main = "main"): Promise<FreshenResult> {
  const g = gitWithWallClock(repoRoot);
  const mainHead = (await g.revparse([main]).catch(() => "")).trim();
  const branchSha = (await g.raw(["rev-parse", "--verify", "--quiet", branch]).catch(() => "")).trim();
  if (!branchSha) return { status: "error", mainHead, error: `分支 ${branch} 不存在` };

  const alreadyFresh = await isAncestor(repoRoot, main, branch);
  if (alreadyFresh) return { status: "current", mainHead };

  const tmp = join(repoRoot, ".kunpeng", "freshen-tmp");
  await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
  try {
    await g.raw(["worktree", "add", "-f", tmp, branch]);
    const wt = gitWithWallClock(tmp);
    try {
      await wt.merge(["--no-ff", main]);
    } catch {
      await wt.merge(["--abort"]).catch(() => {});
      await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
      return { status: "conflict", mainHead };
    }
    await g.raw(["worktree", "remove", "--force", tmp]);
    return { status: "freshened", mainHead };
  } catch (e) {
    await g.raw(["worktree", "remove", "--force", tmp]).catch(() => {});
    return { status: "error", mainHead, error: String(e) };
  }
}

async function isAncestor(repoRoot: string, ancestor: string, descendant: string): Promise<boolean> {
  return execFileAsync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", ancestor, descendant])
    .then(() => true)
    .catch(() => false);
}
