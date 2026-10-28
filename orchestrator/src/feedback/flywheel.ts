import { readdir } from "node:fs/promises";
import type { DriveReport } from "./drive-backlog.js";

export interface FlywheelRoundReport {
  scanned?: { added: number; pending: number };
  skipped?: "busy";
  drive?: DriveReport;
}

/** 数 .kunpeng/locks 下的活锁(*.lock 目录)数量;目录不存在记 0。调用方应先 reclaimDeadLocks 清死锁再数。 */
export async function countActiveLocks(locksDir: string): Promise<number> {
  try {
    const entries = await readdir(locksDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock")).length;
  } catch {
    return 0;
  }
}

/**
 * 飞轮一轮:①(可选)scan 扫描入队 → ②查活锁:有别的流在跑则跳过驱动(busy,不和 peer 抢共享树) → ③drive 驱动。
 * 纯编排——scan/activeLocks/drive 全注入。scan 总先跑(便宜、无后端);忙碌阀只挡昂贵的 drive。
 */
export async function runFlywheelRound(deps: {
  scan?: () => Promise<{ added: string[]; pending: number }>;
  activeLocks: () => Promise<number>;
  drive: () => Promise<DriveReport>;
}): Promise<FlywheelRoundReport> {
  const report: FlywheelRoundReport = {};

  if (deps.scan) {
    const scanned = await deps.scan();
    report.scanned = { added: scanned.added.length, pending: scanned.pending };
  }

  if ((await deps.activeLocks()) > 0) {
    report.skipped = "busy";
    return report;
  }

  report.drive = await deps.drive();
  return report;
}
