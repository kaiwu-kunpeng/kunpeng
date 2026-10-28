import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import { basename, join } from "node:path";

export function flowTmpDir(cwd: string, base = os.tmpdir()): string {
  return join(base, "kunpeng-flows", basename(cwd));
}

export function ensureFlowTmpDir(cwd: string, base?: string): string {
  const path = flowTmpDir(cwd, base);
  mkdirSync(path, { recursive: true });
  return path;
}

export async function removeFlowTmpDir(cwd: string, base?: string): Promise<void> {
  try {
    await rm(flowTmpDir(cwd, base), { recursive: true, force: true });
  } catch {
    // best-effort：临时目录清理失败不得改变 worktree 释放/回滚的异常语义。
  }
}
