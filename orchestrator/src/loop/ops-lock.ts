import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OpsLock {
  pid: number;
  at: number;
  playbookId?: string;
}

export function opsLockPath(stateDir: string, loopId: string): string {
  return join(stateDir, "ops", "locks", `${loopId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

export async function readOpsLock(stateDir: string, loopId: string): Promise<OpsLock | null> {
  try {
    const lock = JSON.parse(await readFile(opsLockPath(stateDir, loopId), "utf8")) as OpsLock | null;
    if (!lock || !Number.isInteger(lock.pid) || lock.pid <= 0 || !Number.isFinite(lock.at)) {
      throw new Error(`invalid ops lock: ${loopId}`);
    }
    return lock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 等不能证明持有者已死，保守视为忙。
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function isLockBusy(lock: OpsLock | null, isAlive = defaultIsAlive): boolean {
  return lock !== null && isAlive(lock.pid);
}

export async function acquireOpsLock(
  stateDir: string,
  loopId: string,
  opts: { pid?: number; playbookId?: string; now?: () => number; isAlive?: (pid: number) => boolean } = {},
): Promise<(() => Promise<void>) | null> {
  const path = opsLockPath(stateDir, loopId);
  await mkdir(dirname(path), { recursive: true });
  const existing = await readOpsLock(stateDir, loopId);
  if (isLockBusy(existing, opts.isAlive)) return null;
  if (existing) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const lock: OpsLock = {
    pid: opts.pid ?? process.pid,
    at: (opts.now ?? Date.now)(),
    ...(opts.playbookId !== undefined ? { playbookId: opts.playbookId } : {}),
  };
  try {
    await writeFile(path, JSON.stringify(lock), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  return async () => {
    const current = await readOpsLock(stateDir, loopId);
    if (current?.pid === lock.pid && current.at === lock.at && current.playbookId === lock.playbookId) {
      await unlink(path);
    }
  };
}
