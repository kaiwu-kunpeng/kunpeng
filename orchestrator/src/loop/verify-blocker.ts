const DEFAULT_MAX_LEN = 2000;
const TRUNCATION_MARKER = "\n…(中段截断)…\n";

export function formatVerifyBlocker(
  result: { passed: boolean; output: string; exitCode: number },
  maxLen = DEFAULT_MAX_LEN,
): string {
  if (result.passed) return "";

  const output = result.output.trim();
  if (!output) {
    return `验证失败:退出码 ${result.exitCode}，命令无输出(常见于 test -f/cd 等静默失败,或产物未落盘到预期路径)`;
  }

  if (output.length <= maxLen) return output;

  const half = Math.max(0, Math.floor(maxLen / 2));
  const head = output.slice(0, half);
  const tail = output.slice(output.length - half);
  return `${head}${TRUNCATION_MARKER}${tail}`;
}
