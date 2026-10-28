import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

// 纯结构：判断 dist 构建产物是否落后于最近提交（合并了但没重建/没重启 → 跑旧代码且静默）。
// 零 IO，供 attention 接线点亮到「待我处理」最显眼位置。

export interface DistFreshness {
  stale: boolean;
  builtAt: number;
  committedAt: number;
  behindMs: number;
}

const DEFAULT_TOLERANCE_MS = 60_000;

export function assessDistFreshness(input: {
  builtAt: number;
  committedAt: number;
  toleranceMs?: number;
}): DistFreshness {
  const { builtAt, committedAt } = input;
  const toleranceMs = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;

  // 任一输入非有限数（NaN/±Infinity）→ 宁漏勿误报。
  if (!Number.isFinite(builtAt) || !Number.isFinite(committedAt) || !Number.isFinite(toleranceMs)) {
    return { stale: false, builtAt, committedAt, behindMs: 0 };
  }

  const behind = committedAt - builtAt;
  const stale = behind > toleranceMs;
  return {
    stale,
    builtAt,
    committedAt,
    behindMs: stale ? behind : 0,
  };
}

export function distStaleTitle(f: DistFreshness): string {
  const minutes = Math.max(0, Math.floor(f.behindMs / 60_000));
  if (minutes < 60) {
    return `构建产物已落后主干约 ${minutes} 分钟，请重建 dist 并重启进程`;
  }
  const hours = Math.floor(minutes / 60);
  return `构建产物已落后主干约 ${hours} 小时，请重建 dist 并重启进程`;
}

// IO 测量与上面的纯判定分离；缺失的构建/提交信息不产生注意力项。
export async function measureDistFreshness(input: {
  repoRoot: string;
  distEntry?: string;
  srcDir?: string;
  toleranceMs?: number;
  git?: (args: string[]) => Promise<string>;
  statMtimeMs?: (path: string) => Promise<number>;
}): Promise<DistFreshness | undefined> {
  const { repoRoot, toleranceMs } = input;
  const distEntry = input.distEntry ?? join(repoRoot, "orchestrator", "dist", "cli.js");
  const srcDir = input.srcDir ?? "orchestrator/src";
  const statMtimeMs = input.statMtimeMs ?? (async (path: string) => (await stat(path)).mtimeMs);
  const git = input.git ?? (async (args: string[]) => {
    const { stdout } = await promisify(execFile)("git", args, { maxBuffer: 1024 * 1024, timeout: 30_000 });
    return stdout;
  });

  try {
    const builtAt = await statMtimeMs(distEntry);
    const timestamp = (await git(["-C", repoRoot, "log", "-1", "--format=%ct", "--", srcDir])).trim();
    if (!timestamp) return undefined;
    const committedAt = Number(timestamp) * 1000;
    if (!Number.isFinite(committedAt)) return undefined;
    return assessDistFreshness({ builtAt, committedAt, toleranceMs });
  } catch {
    return undefined;
  }
}
