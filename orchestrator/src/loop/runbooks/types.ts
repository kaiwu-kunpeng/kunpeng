import type { ActionLevel } from "../../policy/action-levels.js";

/** 处置手册只许五类白名单动作（开悟 §9.10）：停 / 降 / 重试 / 通知 / 起草。 */
export const RUNBOOK_ACTION_KINDS = ["stop", "degrade", "retry", "notify", "draft"] as const;
export type RunbookActionKind = (typeof RUNBOOK_ACTION_KINDS)[number];

/** 事件与动作共用的作用范围；动作范围必须 ⊆ 事件范围（不许顺手处置别的 loop / 流）。 */
export interface RunbookScope { projectId?: string; loopId?: string; flowId?: string; playbookId?: string }

export interface RunbookEvent {
  /** 事件种类，如 ops.playbook.paused / flow.ghost / merge.guard-red。 */
  kind: string;
  at: number;
  scope: RunbookScope;
  detail?: Record<string, unknown>;
}

export interface RunbookAction {
  kind: RunbookActionKind;
  level: ActionLevel;
  summary: string;
  scope: RunbookScope;
}

export interface Runbook {
  id: string;
  rev: number;
  title: string;
  /** 本手册允许的最高动作等级（引擎再用 L2 全局封顶）。 */
  maxLevel: ActionLevel;
  cooldownMs: number;
  appliesTo(event: RunbookEvent): boolean;
  plan(event: RunbookEvent): RunbookAction[];
}

/** 值班员台账一行（append-only）。 */
export interface RunbookRun {
  at: number;
  episodeKey: string;
  eventKind: string;
  runbookId?: string;
  rev?: number;
  outcome: "executed" | "escalated" | "cooldown";
  detail?: string;
}

export type DutyDecision =
  | { action: "execute"; episodeKey: string; runbook: Runbook; actions: RunbookAction[] }
  | { action: "cooldown"; episodeKey: string; runbookId: string; until: number }
  | { action: "escalate"; episodeKey: string; reason: string; runbookId?: string };
