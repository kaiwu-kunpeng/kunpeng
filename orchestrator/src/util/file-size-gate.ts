/** 源码文件体量增量闸（审计 §1.1）：只拦新增膨胀——不在历史清单里的源文件不得超过上限。
 *  历史超限文件登记在清单里、不卡具体行数（多条流并发改大文件时，按行数卡死会把正常改动在回归门上碰红）；
 *  拆小到上限以内后应从清单删除。纯函数。 */
export interface FileSizeViolation {
  file: string;
  lines: number;
  reason: "over-limit" | "stale-entry";
}

/** 与 `wc -l` 一致：数换行符。 */
export function countLines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === "\n") n += 1;
  return n;
}

export function checkFileSizes(
  files: ReadonlyMap<string, number>,
  grandfathered: ReadonlySet<string>,
  limit: number,
): FileSizeViolation[] {
  const violations: FileSizeViolation[] = [];
  for (const [file, lines] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines > limit && !grandfathered.has(file)) violations.push({ file, lines, reason: "over-limit" });
  }
  // 清单条目：文件已删/改名，或已拆到上限以内 → 该删掉，别留死条目。
  for (const file of [...grandfathered].sort()) {
    const lines = files.get(file);
    if (lines === undefined || lines <= limit) violations.push({ file, lines: lines ?? 0, reason: "stale-entry" });
  }
  return violations;
}
