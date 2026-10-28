import type { FlowState } from "../../runtime/flowstate.js";
import type { OpsTickDecision } from "../ops-schedule-guard.js";
import type { OutboxEntry } from "../outbox.js";
import { RUNBOOK_EVENT_KINDS } from "./catalog.js";
import { episodeKey } from "./engine.js";
import type { RunbookEvent, RunbookRun } from "./types.js";

/** P1-11a 给后端全不可用回滚打的前缀。 */
export const BACKEND_DOWN_PREFIX = "[backend-down]";
/** 给 merge-gate 自己的推送重试留窗口。 */
export const STALE_OUTBOX_MS = 30 * 60_000;
/** 回滚类事件只看最近的流，避免陈年旧流反复触发。 */
export const RECENT_FLOW_MS = 24 * 3_600_000;

/** -quiet 也派生事件，是否再次通知由手册冷却决定。 */
export function eventsFromOpsTick(decisions: readonly OpsTickDecision[], projectId: string, now: number): RunbookEvent[] {
  const out: RunbookEvent[] = [];
  for (const decision of decisions) {
    const scope = { projectId, playbookId: decision.playbookId, ...(decision.loopId !== undefined ? { loopId: decision.loopId } : {}) };
    if (decision.action === "paused" || decision.action === "paused-quiet") {
      out.push({ kind: RUNBOOK_EVENT_KINDS.opsPaused, at: now, scope, detail: { tick: decision.detail ?? "" } });
    }
    if (decision.action === "missed" || decision.action === "missed-quiet") {
      out.push({ kind: RUNBOOK_EVENT_KINDS.opsMissed, at: now, scope, detail: { tick: decision.detail ?? "" } });
    }
  }
  return out;
}

/** 流状态 → 幽灵流、合并守门碰红、近期后端全不可用回滚事件。 */
export function eventsFromFlows(
  flows: readonly FlowState[],
  input: { projectId: string; isAlive: (pid: number) => boolean; now: number; recentMs?: number },
): RunbookEvent[] {
  const recentMs = input.recentMs ?? RECENT_FLOW_MS;
  const out: RunbookEvent[] = [];
  for (const flow of flows) {
    const scope = { projectId: input.projectId, flowId: flow.flowId };
    if (flow.status === "running" && flow.pid !== undefined && !input.isAlive(flow.pid)) {
      out.push({ kind: RUNBOOK_EVENT_KINDS.flowGhost, at: input.now, scope, detail: { pid: flow.pid } });
    }
    if (flow.status === "verified" && flow.gateHold?.kind === "guard-red") {
      out.push({ kind: RUNBOOK_EVENT_KINDS.mergeGuardRed, at: input.now, scope, detail: { reason: flow.gateHold.reason } });
    }
    if (flow.status === "rolled-back" && (flow.failureReason ?? "").startsWith(BACKEND_DOWN_PREFIX) && input.now - flow.updatedAt <= recentMs) {
      out.push({ kind: RUNBOOK_EVENT_KINDS.backendDown, at: input.now, scope, detail: { reason: flow.failureReason ?? "" } });
    }
  }
  return out;
}

/** ops 频道里超过重试窗口的 git-push 待发条目才派生事件。 */
export function eventsFromOutbox(entries: readonly OutboxEntry[], input: { projectId: string; now: number; staleMs?: number }): RunbookEvent[] {
  const staleMs = input.staleMs ?? STALE_OUTBOX_MS;
  const out: RunbookEvent[] = [];
  for (const entry of entries) {
    if (entry.status !== "pending" || entry.channel !== "ops") continue;
    const url = entry.payload.urls.find((value) => value.startsWith("git-push://"));
    if (!url || !(input.now - Date.parse(entry.at) >= staleMs)) continue;
    const encodedFlowId = /[?&]flow=([^&#]+)/.exec(url)?.[1];
    let flowId: string | undefined;
    if (encodedFlowId) {
      try {
        flowId = decodeURIComponent(encodedFlowId);
      } catch (error) {
        console.warn(`[duty] outbox ${entry.id} 的 flowId 无法解码：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    out.push({
      kind: RUNBOOK_EVENT_KINDS.outboxPushFailed,
      at: input.now,
      scope: { projectId: input.projectId, ...(flowId ? { flowId } : {}) },
      detail: { outboxId: entry.id, base: entry.payload.keyLocation ?? "main" },
    });
  }
  return out;
}

/** retries 只累计同 episode 已执行的台账行，转人和冷却均不计入。 */
export function withRetries(event: RunbookEvent, history: readonly RunbookRun[]): RunbookEvent {
  const key = episodeKey(event);
  const retries = history.filter((run) => run.episodeKey === key && run.outcome === "executed").length;
  return { ...event, detail: { ...(event.detail ?? {}), retries } };
}
