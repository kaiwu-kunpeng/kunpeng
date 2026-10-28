/** 从 CLI 余参里取"位置参数"(标题/正文等):
 *  - 剔除所有 `--flag`(以 -- 开头的 token)自身;
 *  - valueFlags 里列的是"带值旗标"(如 --status/--type/--supersedes),其紧跟的下一个 token 是值,需一并剔除;
 *  - 不在 valueFlags 里的 `--x` 视为布尔旗标,只剔除自身。
 *  纯函数。 */
export function positionalArgs(rest: string[], valueFlags: string[]): string[] {
  const vf = new Set(valueFlags);
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (vf.has(a)) i++; // 跳过其值
      continue;
    }
    out.push(a);
  }
  return out;
}
