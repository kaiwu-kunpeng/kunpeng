import { gitWithWallClock } from "./git-wall.js";
import { mergeIntoMainAtomic } from "./merge-main-atomic.js";

/** 在临时 worktree 里把 branch 合进 into，绝不 checkout 共享工作树（协作安全 C1）。
 *  先清理残留 merge-tmp（防崩溃后卡死）；冲突即 --abort、清理、返回 ok:false。 */
export async function safeMerge(repoRoot: string, into: string, branch: string): Promise<{ ok: boolean; error?: string }> {
  const g = gitWithWallClock(repoRoot);
  // #3：先区分"分支不存在"与"合并冲突"——不存在直接给准确文案，不再把缺失误报成"与 X 冲突"。
  // rev-parse --verify --quiet：分支存在→返回 sha；不存在→simple-git 不抛、返回空串（故判返回值而非 catch）。
  const branchSha = await g.raw(["rev-parse", "--verify", "--quiet", branch]).catch(() => "");
  if (!branchSha.trim()) return { ok: false, error: `分支 ${branch} 不存在` };
  // into 正是主工作树当前分支（如自己 repo 合到 main）：必须直接在主树合并。
  // 否则用 `worktree add -f` 强行另开 worktree 检出 into 会令主树与 ref 不一致 → 工作树文件被「删掉」假象、酿数据丢失。
  const current = await g.branchLocal().then((b) => b.current).catch(() => "");
  if (current === into) {
    try { await g.merge(["--no-ff", branch]); return { ok: true }; }
    catch { await g.merge(["--abort"]).catch(() => {}); return { ok: false, error: `与 ${into} 冲突，已安全中止` }; }
  }
  // into 是别的分支（主树在别处干活，没 checkout 在 into 上）：用 detached 临时 worktree 合 + 原子 CAS 换 ref。
  // detached 不动 into 工作树（协作安全 C1，无 desync）；CAS（update-ref into <merged> <before>）确保——
  // 即便有 lock-free 写者在窗口内移动了 into，也会失败而非静默 orphan（本会话亲历 C10 commit 被 orphan）。
  const r = await mergeIntoMainAtomic(repoRoot, branch, into);
  if (r.raced) return { ok: false, error: `${into} 在合并期间被并发移动（CAS 失败），已安全中止` };
  if (r.conflict) return { ok: false, error: `与 ${into} 冲突，已安全中止` };
  if (!r.ok) return { ok: false, error: r.error ?? `合并 ${branch} → ${into} 失败` };
  return { ok: true };
}
