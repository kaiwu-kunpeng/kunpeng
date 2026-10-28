import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_MAX_CONCURRENT_FLOWS = 4;

function positiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

export function resolveMaxConcurrentFlows(env: NodeJS.ProcessEnv, repo?: { maxConcurrent?: number }): number {
  const fromEnv = Number(env.KUNPENG_MAX_CONCURRENT_FLOWS);
  if (positiveInteger(fromEnv)) return fromEnv;
  if (positiveInteger(repo?.maxConcurrent)) return repo.maxConcurrent;
  return DEFAULT_MAX_CONCURRENT_FLOWS;
}

export function slotsDir(kunpengDir: string): string {
  return join(kunpengDir, "locks", "slots");
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function removeSlot(path: string, inode: number): Promise<void> {
  try {
    // 旧释放函数不能删除同一路径上后来者的槽位。
    if ((await stat(path)).ino === inode) await rm(path, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function reclaimStaleSlot(path: string, staleMs: number): Promise<boolean> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  // mkdir 与 owner 落盘之间有窗口；无 owner 的新目录仍按占用处理。
  let stale = info.mtimeMs < Date.now() - staleMs;
  try {
    const owner: unknown = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
    if (owner !== null && typeof owner === "object") {
      const { pid, at } = owner as { pid?: unknown; at?: unknown };
      if (typeof at === "number" && Number.isFinite(at)) stale = at < Date.now() - staleMs;
      if (typeof pid === "number" && positiveInteger(pid) && !pidAlive(pid)) stale = true;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!stale) return false;
  await removeSlot(path, info.ino);
  return true;
}

export async function acquireFlowSlot(kunpengDir: string, opts: {
  max: number;
  pid?: number;
  staleMs?: number;
  pollMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<() => Promise<void>> {
  const { max } = opts;
  if (max <= 0) return async () => {};
  if (!positiveInteger(max)) throw new RangeError("max 必须为整数");
  const root = slotsDir(kunpengDir);
  const pid = opts.pid ?? process.pid;
  const staleMs = opts.staleMs ?? 6 * 60 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const log = opts.log ?? console.log;
  let delay = Math.min(opts.pollMs ?? 1000, 30_000);
  const startedAt = Date.now();
  await mkdir(root, { recursive: true });
  while (true) {
    for (let i = 0; i < max; i++) {
      const path = join(root, String(i));
      try {
        await mkdir(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      let inode: number;
      try {
        inode = (await stat(path)).ino;
        await writeFile(join(path, "owner.json"), JSON.stringify({ pid, at: Date.now() }));
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      let release: Promise<void> | undefined;
      return () => release ??= removeSlot(path, inode);
    }

    let reclaimed = false;
    for (let i = 0; i < max; i++) {
      if (await reclaimStaleSlot(join(root, String(i)), staleMs)) reclaimed = true;
    }
    if (reclaimed) continue;
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error(`并发上限 ${max}：等待 ${timeoutMs}ms 未获得流槽位`);
    const waitMs = Math.min(remaining, delay * (1 + Math.random() * 0.2));
    log(`[slots] 并发上限 ${max}，等待 ${Math.round(waitMs)}ms 后重试`);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    delay = Math.min(delay * 2, 30_000);
  }
}
