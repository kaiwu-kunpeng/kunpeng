/**
 * conventions 落地质量门（确定性纯函数）。
 *
 * 对拟写入 conventions.md 的单条约定文本做 fail-closed 检查，避免占位模板、
 * 本机路径和流水账进入可演进宪法。
 */
export function conventionsChangeProblems(text: string): string[] {
  const problems: string[] = [];

  if (text.trim().length === 0) problems.push("空文本");
  if (text.includes("建议补一条约定")) problems.push("占位模板非真约定");
  if (text.includes("复发卡点「」")) problems.push("空卡点占位");
  if (text.includes("/Users/") || text.includes("/private/")) problems.push("含本机绝对路径");
  if (text.length > 400) problems.push("超长流水账(>400字符)");

  return problems;
}
