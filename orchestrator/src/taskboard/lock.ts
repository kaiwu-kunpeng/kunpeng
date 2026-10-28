import { mkdir, open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hasErrnoCode } from "../util/errors.js";

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function duration(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${name} 必须是非负有限数`);
  }
  return resolved;
}

export async function withDirLock<T>(
  dir: string,
  fn: () => Promise<T>,
  opts?: { staleMs?: number; timeoutMs?: number },
): Promise<T> {
  const staleMs = duration(opts?.staleMs, DEFAULT_STALE_MS, "staleMs");
  const timeoutMs = duration(opts?.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const lockPath = join(dir, ".lock");
  const startedAt = Date.now();

  await mkdir(dir, { recursive: true });

  while (true) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (!hasErrnoCode(error, "EEXIST")) throw error;

      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > staleMs) {
          await unlink(lockPath).catch((unlinkError: unknown) => {
            if (!hasErrnoCode(unlinkError, "ENOENT")) throw unlinkError;
          });
          continue;
        }
      } catch (statError) {
        if (hasErrnoCode(statError, "ENOENT")) continue;
        throw statError;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`获取目录锁超时: ${lockPath}`, { cause: error });
      }
      await sleep(RETRY_MS);
      continue;
    }

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (staleMs > 0) {
      heartbeat = setInterval(() => {
        const now = new Date();
        void handle.utimes(now, now).catch(() => undefined);
      }, Math.max(1, Math.floor(staleMs / 3)));
      heartbeat.unref();
    }

    try {
      return await fn();
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      try {
        const [held, current] = await Promise.all([handle.stat(), stat(lockPath)]);
        if (held.dev === current.dev && held.ino === current.ino) {
          await unlink(lockPath);
        }
      } catch (error) {
        if (!hasErrnoCode(error, "ENOENT")) {
          console.warn("目录锁清理失败", { lockPath, error });
        }
      } finally {
        await handle.close().catch((error: unknown) => {
          console.warn("目录锁句柄关闭失败", { lockPath, error });
        });
      }
    }
  }
}
