export function isModelLimitError(text: string | undefined): boolean {
  return typeof text === "string" && /reached your .{0,40}limit/i.test(text);
}

export function describeChatExit(exitCode: number, resultError: string | undefined, stderr: string): string {
  const err = resultError?.trim();
  if (err && isModelLimitError(err)) {
    return `模型额度用尽,请在对话里切换其它模型后重发:${err}`;
  }
  const tail = err || stderr.trim().slice(-500);
  return tail ? `对话进程异常退出(exit ${exitCode}):${tail}` : `对话进程异常退出(exit ${exitCode})`;
}
