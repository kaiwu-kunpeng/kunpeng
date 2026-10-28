import type { OpsScheduleEntry } from "./ops-playbook-run.js";
import { cadenceMs } from "./ops-run.js";
import type { PlaybookDef } from "./playbook.js";

/** 应跑账本上的两道守卫（ADR-0020 / 审计 P1-1b、P1-4）：
 *  ① 连续失败自动暂停——同一 playbook 连着 N 次 error（中间只夹 paused/missed 这类告警行）就不再起，直到人 `ops resume`；
 *  ② 漏跑告警——到期超过两个周期还没有一次 ran。两种告警都带 24h 去重，别每分钟刷屏。 */

export const AUTO_PAUSE_ERRORS = 3;
export const ALERT_DEDUPE_MS = 24 * 3_600_000;

const ALERT_OUTCOMES = new Set<OpsScheduleEntry["outcome"]>(["paused", "missed", "locked"]);

/** 从账本尾部往前数连续 error（跳过告警行）；遇到 ran / gated / skipped / resumed 即停。 */
export function consecutiveErrorCount(entries: readonly OpsScheduleEntry[], playbookId: string): number {
  let n = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.playbookId !== playbookId) continue;
    if (ALERT_OUTCOMES.has(e.outcome)) continue;
    if (e.outcome === "error") { n++; continue; }
    break;
  }
  return n;
}

export function shouldAutoPause(entries: readonly OpsScheduleEntry[], playbookId: string, threshold = AUTO_PAUSE_ERRORS): boolean {
  return consecutiveErrorCount(entries, playbookId) >= threshold;
}

/** 该 playbook 最近一条指定 outcome 的时间；没有 → undefined。 */
export function lastOutcomeAt(entries: readonly OpsScheduleEntry[], playbookId: string, outcome: OpsScheduleEntry["outcome"]): number | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.playbookId === playbookId && e.outcome === outcome) return e.at;
  }
  return undefined;
}

export function alertedRecently(entries: readonly OpsScheduleEntry[], playbookId: string, outcome: "paused" | "missed", now: number, windowMs = ALERT_DEDUPE_MS): boolean {
  const at = lastOutcomeAt(entries, playbookId, outcome);
  return at !== undefined && now - at < windowMs;
}

/** 漏跑：有 loopId、跑过至少一波、距上一波 ≥ 2 个周期，且这期间账本里没有 ran。 */
export function isMissed(playbook: PlaybookDef, lastRunAt: number | undefined, entries: readonly OpsScheduleEntry[], now: number): boolean {
  if (!playbook.loopId || lastRunAt === undefined) return false;
  const period = cadenceMs(playbook.cadence);
  if (now - lastRunAt < 2 * period) return false;
  const ranAt = lastOutcomeAt(entries, playbook.id, "ran");
  return ranAt === undefined || ranAt < now - 2 * period;
}

export type OpsTickAction = "launch" | "gate" | "locked" | "paused" | "paused-quiet" | "missed" | "missed-quiet" | "not-due" | "no-loop";

export interface OpsTickDecision {
  playbookId: string;
  loopId?: string;
  action: OpsTickAction;
  detail?: string;
}

/** 一轮定时器的纯决策：每个 playbook 一至两条，漏跑与到期决策可并存。-quiet 表示 24h 内已报过、只记账不再喊人。 */
export function planOpsTick(input: {
  playbooks: readonly PlaybookDef[];
  due: ReadonlySet<string>;
  lastRunByLoop: Readonly<Record<string, number>>;
  entries: readonly OpsScheduleEntry[];
  lockBusy: (loopId: string) => boolean;
  now: number;
}): OpsTickDecision[] {
  const out: OpsTickDecision[] = [];
  for (const playbook of input.playbooks) {
    const loopId = playbook.loopId;
    if (!loopId) { out.push({ playbookId: playbook.id, action: "no-loop" }); continue; }
    const base = { playbookId: playbook.id, loopId };
    if (isMissed(playbook, input.lastRunByLoop[loopId], input.entries, input.now)) {
      const quiet = alertedRecently(input.entries, playbook.id, "missed", input.now);
      out.push({ ...base, action: quiet ? "missed-quiet" : "missed", detail: `距上一波已超两个周期（${playbook.cadence ?? "weekly"}）仍无成功波` });
    }
    if (!input.due.has(playbook.id)) { out.push({ ...base, action: "not-due" }); continue; }
    if (playbook.gate !== "auto") { out.push({ ...base, action: "gate" }); continue; }
    if (shouldAutoPause(input.entries, playbook.id)) {
      const n = consecutiveErrorCount(input.entries, playbook.id);
      const quiet = alertedRecently(input.entries, playbook.id, "paused", input.now);
      out.push({ ...base, action: quiet ? "paused-quiet" : "paused", detail: `连续失败 ${n} 次，自动暂停；kunpeng ops resume ${playbook.id} 恢复` });
      continue;
    }
    if (input.lockBusy(loopId)) { out.push({ ...base, action: "locked" }); continue; }
    out.push({ ...base, action: "launch" });
  }
  return out;
}
