import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// 原子目录锁：串行化跨进程的关键区（如向 main 合并）。并行多 agent 共享同一 repo 时，
// 两个 `kunpeng merge` 同时动 git index / main HEAD 会互相踩；本锁让它们排队，谁先谁后都对。
// 死锁自愈：持有者进程已死 / 超 staleMs → 偷锁（防崩溃的合并把后续永久卡死）。finally 必释放。

export interface FileLockOpts { staleMs?: number; timeoutMs?: number; pollMs?: number; }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 在 lockDir 锁保护下串行执行 fn。lockDir 自身就是锁（原子 mkdir）；其父目录会被自动创建。 */
export async function withFileLock<T>(lockDir: string, fn: () => Promise<T>, opts: FileLockOpts = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 5 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 4 * 60 * 1000;
  const pollMs = opts.pollMs ?? 300;
  const owner = join(lockDir, "owner.json");
  await mkdir(dirname(lockDir), { recursive: true }); // 确保父目录在；锁目录本身必须非递归原子创建

  async function tryAcquire(): Promise<boolean> {
    try {
      await mkdir(lockDir); // 原子：已存在即抛 EEXIST
      await writeFile(owner, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const stale = await (async (): Promise<boolean> => {
        const o = JSON.parse(await readFile(owner, "utf8")) as { pid?: number; at?: number };
        return (Date.now() - (o.at ?? 0) > staleMs) || (typeof o.pid === "number" && !pidAlive(o.pid));
      })().catch(() => true); // owner 文件缺失/坏 → 当死锁
      if (stale) { await rm(lockDir, { recursive: true, force: true }); return tryAcquire(); }
      return false;
    }
  }

  const t0 = Date.now();
  while (!(await tryAcquire())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`等锁超时(${timeoutMs}ms)：${lockDir}（确认无同类操作在跑后可手动删除）`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true }); // 务必释放，即使 fn 抛错
  }
}
