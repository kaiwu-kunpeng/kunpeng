import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

/** 收集 worktree 工具链软链指向的外部目录，不修改文件系统。 */
export function collectToolchainWritableRoots(cwd: string): string[] {
  let cwdReal: string;
  try {
    cwdReal = realpathSync(cwd);
  } catch {
    return [];
  }

  const candidates = [cwd];
  try {
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (!entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
        candidates.push(join(cwd, entry.name));
      }
    }
  } catch { /* 无法列举子目录时，仍检查 cwd 自身的工具链。 */ }

  const roots = new Set<string>();
  const cwdPrefix = cwdReal.endsWith(sep) ? cwdReal : cwdReal + sep;
  for (const candidate of candidates) {
    for (const name of ["node_modules", "dist"]) {
      try {
        const path = join(candidate, name);
        if (!lstatSync(path).isSymbolicLink()) continue;
        const target = realpathSync(path);
        if (target !== cwdReal && !target.startsWith(cwdPrefix)) roots.add(target);
      } catch { /* 缺失、断链或不可访问的条目不影响其它工具链。 */ }
    }
  }
  return [...roots].sort();
}
