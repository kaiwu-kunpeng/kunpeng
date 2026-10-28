export function resolveRedFirst(env: NodeJS.ProcessEnv): boolean {
  return !["0", "off", "false"].includes(env.KUNPENG_RED_FIRST?.trim().toLowerCase() ?? "");
}

export interface DiffShortStat {
  files: number;
  insertions: number;
  deletions: number;
}

export function parseShortStat(raw: string): DiffShortStat {
  return {
    files: Number(/\b(\d+) files? changed\b/.exec(raw)?.[1] ?? 0),
    insertions: Number(/\b(\d+) insertions?\(\+\)/.exec(raw)?.[1] ?? 0),
    deletions: Number(/\b(\d+) deletions?\(-\)/.exec(raw)?.[1] ?? 0),
  };
}

export const NOT_RED_FIRST_KIND = "not-red-first" as const;

export function formatNotRedFirst(exitCode: number): string {
  return `验收在实现前已通过（没先红，exit=${exitCode}）：作者测试/验收命令没有锁住目标，实现前后无差别`;
}
