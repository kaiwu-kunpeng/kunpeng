import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { gitWithWallClock } from "./git-wall.js";

export interface GcResult {
  base: string;
  deleted: string[];
  deletedTags: string[];
  kept: string[];
  logsDeleted: number;   // 清理的过期 cockpit 子进程日志数（防 .kunpeng/cockpit/logs 磁盘膨胀）
  dryRun: boolean;
}

function isKunpengBranch(branch: string): boolean {
  return branch.startsWith("kp/") || branch.startsWith("kp-stale/");
}

/** 清理 .kunpeng/cockpit/logs 下 mtime 超过 maxAgeMs 的子进程日志（A1 落日志只增不减，治本磁盘膨胀）。
 *  dryRun 只数不删；目录不存在按 0 处理；单个文件竞态/读不到忽略不中断。返回清理的日志文件数。 */
async function gcCockpitLogs(repoRoot: string, dryRun: boolean, now: number, maxAgeMs = 7 * 24 * 3600 * 1000): Promise<number> {
  const dir = join(repoRoot, ".kunpeng", "cockpit", "logs");
  let files: string[];
  try { files = await readdir(dir); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    if (!f.endsWith(".log")) continue;
    const p = join(dir, f);
    try {
      const st = await stat(p);
      if (now - st.mtimeMs > maxAgeMs) { if (!dryRun) await unlink(p); n++; }
    } catch { /* 竞态被别处删/读不到，忽略 */ }
  }
  return n;
}

export async function runGc(opts: { repoRoot: string; base?: string; dryRun?: boolean; now?: number }): Promise<GcResult> {
  const git = gitWithWallClock(opts.repoRoot);
  const local = await git.branchLocal();
  const localBranches = new Set(local.all);
  const base = opts.base ?? local.current;
  const dryRun = opts.dryRun ?? false;
  const candidates = local.all.filter((branch) => isKunpengBranch(branch) && branch !== base);
  const merged = new Set((await git.branch(["--merged", base])).all);
  const toDelete = candidates.filter((branch) => merged.has(branch));

  const deleted: string[] = [];
  if (dryRun) {
    deleted.push(...toDelete);
  } else {
    for (const branch of toDelete) {
      try {
        await git.raw(["branch", "-D", branch]);
        deleted.push(branch);
      } catch (e) {
        console.error(`[gc] WARN 删除分支失败 ${branch}: ${String(e)}`);
      }
    }
  }

  const checkpointPrefix = "kp-ckpt/";
  const checkpointTags = (await git.raw(["tag", "--list", `${checkpointPrefix}*`]))
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const terminalCheckpointTags = checkpointTags.filter((tag) => {
    const remainder = tag.slice(checkpointPrefix.length);
    const separator = remainder.indexOf("/");
    if (separator <= 0) return false;
    const flowId = remainder.slice(0, separator);
    return !localBranches.has(`kp/${flowId}`);
  });
  const deletedTags: string[] = [];
  if (dryRun) {
    deletedTags.push(...terminalCheckpointTags);
  } else {
    for (const tag of terminalCheckpointTags) {
      try {
        await git.raw(["tag", "-d", tag]);
        deletedTags.push(tag);
      } catch (e) {
        console.error(`[gc] WARN 删除 checkpoint 标签失败 ${tag}: ${String(e)}`);
      }
    }
  }

  const deletedSet = new Set(deleted);
  const kept = candidates.filter((branch) => !deletedSet.has(branch));
  // 顺带清过期 cockpit 日志（与分支 GC 同属"运行态收敛"，显式命令、非自动）。
  const logsDeleted = await gcCockpitLogs(opts.repoRoot, dryRun, opts.now ?? Date.now());
  return { base, deleted, deletedTags, kept, logsDeleted, dryRun };
}
