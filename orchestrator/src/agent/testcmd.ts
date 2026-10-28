/** 只剥一层整条命令外的反引号，保留命令内部的 shell 语法。 */
export function normalizeTestCmd(raw: string): string {
  const cmd = raw.trim();
  if (cmd.length > 6 && cmd.startsWith("```") && cmd.endsWith("```")) {
    return cmd.slice(3, -3).trim();
  }
  if (cmd.length > 2 && cmd.startsWith("`") && cmd.endsWith("`") && !cmd.slice(1, -1).includes("`")) {
    return cmd.slice(1, -1).trim();
  }
  return cmd;
}

/** 取正文最后一条 TESTCMD；规范化后为空时视为未提供。 */
export function parseTestCmdLine(text: string): string | undefined {
  const matches = [...text.matchAll(/^[ \t]*TESTCMD:[ \t]*(.+?)[ \t]*$/gm)];
  if (!matches.length) return undefined;
  return normalizeTestCmd(matches[matches.length - 1][1]) || undefined;
}
