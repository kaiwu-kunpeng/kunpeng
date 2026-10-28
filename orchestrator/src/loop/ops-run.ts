import type { PlaybookDef } from "./playbook.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;
const MONTH_MS = 2_592_000_000;

export function cadenceMs(cadence?: string): number {
  if (cadence === "daily") return DAY_MS;
  if (cadence === "monthly") return MONTH_MS;
  const every = /^every:(\d+)(h|d|w)$/.exec(cadence ?? "");
  if (every) {
    const unit = every[2] === "h" ? 3_600_000 : every[2] === "d" ? DAY_MS : WEEK_MS;
    const interval = Number(every[1]) * unit;
    if (interval > 0 && Number.isFinite(interval)) return interval;
  }
  return WEEK_MS;
}

export function duePlaybooks(
  playbooks: PlaybookDef[],
  lastRunByLoop: Record<string, number>,
  now: number,
): PlaybookDef[] {
  return playbooks.filter((playbook) => {
    const loopId = playbook.loopId;
    if (!loopId) return false;

    const lastRun = lastRunByLoop[loopId];
    return lastRun === undefined || now - lastRun >= cadenceMs(playbook.cadence);
  });
}

export function diffOpsGotchas(
  prev: string[],
  next: string[],
): { added: string[]; resolved: string[]; persisted: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);

  return {
    added: next.filter((item) => !prevSet.has(item)),
    resolved: prev.filter((item) => !nextSet.has(item)),
    persisted: next.filter((item) => prevSet.has(item)),
  };
}
