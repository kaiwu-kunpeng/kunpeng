import type { SimpleGit } from "simple-git";

/** 解析 `git grep -I -c "^" <ref> -- <pathspec>` 的输出。
 *  每行形如 `ref:path:count`，取最后一个冒号后的行数求和。
 *  口径＝已合入该 ref 的代码行数，与工作树检在哪个分支无关（治本：过审=main，不数工作树）。 */
export function parseGrepLineCounts(output: string): number {
  let sum = 0;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(":");
    if (idx < 0) continue;
    const n = Number.parseInt(trimmed.slice(idx + 1), 10);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

/** 从 git ref 数某 pathspec 的行数（不依赖工作树检出）。
 *  无匹配时 git grep 退出码非零 → simple-git 抛错；ref 不存在亦抛错——由调用方兜底回退文件系统扫描。 */
export async function countLinesFromRef(git: SimpleGit, ref: string, pathspec: string): Promise<number> {
  const out = await git.raw(["grep", "-I", "-c", "^", ref, "--", pathspec]);
  return parseGrepLineCounts(out);
}
