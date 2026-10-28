export interface CliContext {
  repoRoot: string;
  kunpengHome: string;
  rest: string[];
  argv: string[];
  flags: Set<string>;
  repoArg?: string;
  acceptArg?: string;
  nameArg?: string;
  concurrencyArg?: string;
  goalArg?: string;
  intervalArg?: string;
  sourcesArg?: string;
  outArg?: string;
  authArg?: string;
  discoverArg?: string;
  maxActionsArg?: string;
  descArg?: string;
  limitArg?: string;
  topicArg?: string;
  pageArg?: string;
}

export interface CliCommand {
  name: string;
  /** 单命令帮助，以「用法: kunpeng <命令名>」开头。 */
  usage?: string;
  run(context: CliContext): void | Promise<void>;
}

/** CLI 退出码：0 成功；1 用法或参数错误；2 业务失败；3 递归守卫拒绝。 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const commands: CliCommand[] = [];

export function registerCliCommand(command: CliCommand): void {
  const existing = commands.findIndex((candidate) => candidate.name === command.name);
  if (existing >= 0) commands[existing] = command;
  else commands.push(command);
}

export async function dispatchCliCommand(name: string, context: CliContext): Promise<boolean> {
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) return false;
  try {
    await command.run(context);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
  return true;
}

export function listCliCommands(): CliCommand[] {
  return [...commands];
}
