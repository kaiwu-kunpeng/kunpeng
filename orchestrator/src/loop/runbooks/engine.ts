import { ACTION_LEVELS, type ActionLevel } from "../../policy/action-levels.js";
import type { DutyDecision, Runbook, RunbookAction, RunbookEvent, RunbookRun, RunbookScope } from "./types.js";

/** 同一 episode（事件种类 × 范围）72 小时内跨手册最多处置 3 次，超出转人（开悟 §9.10）。 */
export const EPISODE_WINDOW_MS = 72 * 3_600_000;
export const EPISODE_MAX_RUNS = 3;
/** 手册动作全局封顶 L2：对外可见（L3/L4）的处置永远不自动做。 */
export const RUNBOOK_MAX_LEVEL: ActionLevel = "L2";

function levelIndex(level: ActionLevel): number {
  return ACTION_LEVELS.indexOf(level);
}
export function levelAtMost(level: ActionLevel, cap: ActionLevel): boolean {
  return levelIndex(level) <= levelIndex(cap);
}

/** episode 键：事件种类 + 排序后的范围键值，稳定可比。 */
export function episodeKey(event: Pick<RunbookEvent, "kind" | "scope">): string {
  const parts = (Object.entries(event.scope) as Array<[string, string | undefined]>)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return [event.kind, ...parts].join("|");
}

/** 动作范围 ⊆ 事件范围：动作声明的每个键都必须与事件相同；动作不得带事件没有的键。 */
export function scopeWithin(action: RunbookScope, event: RunbookScope): boolean {
  return (Object.entries(action) as Array<[keyof RunbookScope, string | undefined]>)
    .every(([key, value]) => value === undefined || event[key] === value);
}

function episodeRuns(history: readonly RunbookRun[], key: string, now: number): RunbookRun[] {
  return history.filter((run) => run.episodeKey === key && run.outcome === "executed" && now - run.at <= EPISODE_WINDOW_MS);
}

/** 值班员纯决策：无匹配 / 多匹配 / 预算用尽 / 越级 / 越范围 / 空动作 一律转人（fail-closed）；冷却期内不重复处置。 */
export function planDuty(event: RunbookEvent, runbooks: readonly Runbook[], history: readonly RunbookRun[], now: number): DutyDecision {
  const key = episodeKey(event);
  const matches = runbooks.filter((runbook) => runbook.appliesTo(event));
  if (matches.length === 0) return { action: "escalate", episodeKey: key, reason: `无匹配手册（${event.kind}）` };
  if (matches.length > 1) return { action: "escalate", episodeKey: key, reason: `多手册命中：${matches.map((r) => r.id).join("/")}` };
  const runbook = matches[0]!;
  const executed = episodeRuns(history, key, now);
  if (executed.length >= EPISODE_MAX_RUNS) {
    return { action: "escalate", episodeKey: key, runbookId: runbook.id, reason: `episode 预算用尽：72h 内已处置 ${executed.length} 次` };
  }
  const lastSame = executed.filter((run) => run.runbookId === runbook.id).at(-1);
  if (lastSame && now - lastSame.at < runbook.cooldownMs) {
    return { action: "cooldown", episodeKey: key, runbookId: runbook.id, until: lastSame.at + runbook.cooldownMs };
  }
  const actions = runbook.plan(event);
  if (actions.length === 0) return { action: "escalate", episodeKey: key, runbookId: runbook.id, reason: "手册未给出动作" };
  const overLevel = actions.find((a) => !levelAtMost(a.level, runbook.maxLevel) || !levelAtMost(a.level, RUNBOOK_MAX_LEVEL));
  if (overLevel) return { action: "escalate", episodeKey: key, runbookId: runbook.id, reason: `动作越级：${overLevel.kind} ${overLevel.level} > ${runbook.maxLevel}/${RUNBOOK_MAX_LEVEL}` };
  const outOfScope = actions.find((a) => !scopeWithin(a.scope, event.scope));
  if (outOfScope) return { action: "escalate", episodeKey: key, runbookId: runbook.id, reason: `动作越出事件范围：${outOfScope.kind} ${outOfScope.summary}` };
  return { action: "execute", episodeKey: key, runbook, actions };
}

/** 把决策落成台账一行（由值班员追加到 runbook-runs.jsonl）。 */
export function runFromDecision(event: RunbookEvent, decision: DutyDecision, now: number): RunbookRun {
  if (decision.action === "execute") {
    return { at: now, episodeKey: decision.episodeKey, eventKind: event.kind, runbookId: decision.runbook.id, rev: decision.runbook.rev, outcome: "executed", detail: decision.actions.map((a) => `${a.kind}:${a.summary}`).join("；") };
  }
  if (decision.action === "cooldown") {
    return { at: now, episodeKey: decision.episodeKey, eventKind: event.kind, runbookId: decision.runbookId, outcome: "cooldown", detail: `冷却至 ${new Date(decision.until).toISOString()}` };
  }
  return { at: now, episodeKey: decision.episodeKey, eventKind: event.kind, ...(decision.runbookId ? { runbookId: decision.runbookId } : {}), outcome: "escalated", detail: decision.reason };
}

export function summarizeActions(actions: readonly RunbookAction[]): string {
  return actions.map((a) => `[${a.level}] ${a.kind}: ${a.summary}`).join("\n");
}
