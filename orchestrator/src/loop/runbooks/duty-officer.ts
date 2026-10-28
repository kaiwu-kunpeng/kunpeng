import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { FlowTracker } from "../../runtime/flowstate.js";
import type { SwitchboardSender } from "../../switchboard/store.js";
import { flushOutbox } from "../outbox.js";
import { RUNBOOK_CATALOG, RUNBOOK_EVENT_KINDS } from "./catalog.js";
import { planDuty, runFromDecision, summarizeActions } from "./engine.js";
import { withRetries } from "./events.js";
import type { DutyDecision, Runbook, RunbookAction, RunbookActionKind, RunbookEvent, RunbookRun } from "./types.js";

export type DutyExecutor = (action: RunbookAction, event: RunbookEvent) => Promise<string | undefined>;
export type DutyExecutors = Record<RunbookActionKind, DutyExecutor>;

export interface DutyTickItem {
  event: RunbookEvent;
  decision: DutyDecision;
  outcome: "executed" | "escalated" | "cooldown" | "dry-run";
  detail?: string;
}

export function runbookLedgerPath(stateDir: string): string {
  return join(stateDir, "ops", "runbook-runs.jsonl");
}

export async function readRunbookRuns(stateDir: string): Promise<RunbookRun[]> {
  let text: string;
  try {
    text = await readFile(runbookLedgerPath(stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunbookRun);
}

export async function appendRunbookRun(stateDir: string, run: RunbookRun): Promise<void> {
  await mkdir(join(stateDir, "ops"), { recursive: true });
  await appendFile(runbookLedgerPath(stateDir), `${JSON.stringify(run)}\n`, "utf8");
}

/** 一轮按 episode 去重，执行白名单动作并落账；执行失败立即停止后续动作并转人。 */
export async function runDutyTick(input: {
  stateDir: string;
  events: readonly RunbookEvent[];
  executors: DutyExecutors;
  escalate: (event: RunbookEvent, reason: string) => Promise<void>;
  runbooks?: readonly Runbook[];
  now?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<DutyTickItem[]> {
  const now = input.now ?? Date.now();
  const log = input.log ?? (() => undefined);
  const runbooks = input.runbooks ?? RUNBOOK_CATALOG;
  const history = await readRunbookRuns(input.stateDir);
  const seen = new Set<string>();
  const items: DutyTickItem[] = [];
  for (const raw of input.events) {
    const event = withRetries(raw, history);
    const decision = planDuty(event, runbooks, history, now);
    if (seen.has(decision.episodeKey)) continue;
    seen.add(decision.episodeKey);
    if (decision.action === "cooldown") {
      items.push({ event, decision, outcome: "cooldown", detail: `冷却至 ${new Date(decision.until).toISOString()}` });
      continue;
    }
    if (decision.action === "escalate") {
      await input.escalate(event, decision.reason);
      const run = runFromDecision(event, decision, now);
      if (!input.dryRun) await appendRunbookRun(input.stateDir, run);
      history.push(run);
      items.push({ event, decision, outcome: "escalated", detail: decision.reason });
      log(`[duty] 转人 ${event.kind}：${decision.reason}`);
      continue;
    }
    if (input.dryRun) {
      items.push({ event, decision, outcome: "dry-run", detail: summarizeActions(decision.actions) });
      continue;
    }
    const done: string[] = [];
    let failure: string | undefined;
    for (const action of decision.actions) {
      try {
        const note = await input.executors[action.kind](action, event);
        done.push(`${action.kind}:${note ?? action.summary}`);
      } catch (error) {
        failure = `执行 ${action.kind} 失败：${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
    if (failure) {
      await input.escalate(event, failure);
      const run: RunbookRun = { at: now, episodeKey: decision.episodeKey, eventKind: event.kind, runbookId: decision.runbook.id, rev: decision.runbook.rev, outcome: "escalated", detail: failure };
      await appendRunbookRun(input.stateDir, run);
      history.push(run);
      items.push({ event, decision, outcome: "escalated", detail: failure });
      log(`[duty] ${decision.runbook.id} ${failure}`);
      continue;
    }
    const run = runFromDecision(event, decision, now);
    await appendRunbookRun(input.stateDir, run);
    history.push(run);
    items.push({ event, decision, outcome: "executed", detail: done.join("；") });
    log(`[duty] ${decision.runbook.id} 已处置 ${event.kind}：${done.join("；")}`);
  }
  return items;
}

/** 推送前确认远端 base 是本地祖先；无法证明时不推。 */
export async function pushIfRemoteBehind(repoRoot: string, base: string): Promise<boolean> {
  const git = simpleGit({ baseDir: repoRoot, timeout: { block: 30_000 } });
  const remote = (await git.raw(["ls-remote", "origin", base])).split(/\s+/)[0] ?? "";
  if (remote) {
    try {
      await git.raw(["merge-base", "--is-ancestor", remote, base]);
    } catch {
      return false;
    }
  }
  await git.push("origin", base);
  return true;
}

/** 降级只落标记，消费方由后续派流侧实现。 */
export function defaultDutyExecutors(deps: {
  repoRoot: string;
  stateDir: string;
  sender: SwitchboardSender;
  tracker: Pick<FlowTracker, "markCrashed">;
  launch: (args: string[]) => { pid: number; logPath: string };
  push?: (base: string) => Promise<boolean>;
  now?: () => number;
}): DutyExecutors {
  const now = deps.now ?? Date.now;
  const send = async (topic: string, body: string, urgent: boolean): Promise<void> => {
    await deps.sender.send({ from: "duty", to: "all", topic, body, urgent, origin: { kind: "schedule" } });
  };
  return {
    notify: async (action, event) => { await send(`值班员 · ${event.kind}`, action.summary, true); return undefined; },
    draft: async (action, event) => { await send(`值班员草稿 · ${event.kind}`, `草稿：${action.summary}`, false); return undefined; },
    stop: async (action, event) => {
      if (!event.scope.flowId) throw new Error("stop 需要 flowId");
      await deps.tracker.markCrashed(event.scope.flowId, `duty:${action.summary}`);
      return `已标 crashed ${event.scope.flowId}`;
    },
    degrade: async (action, event) => {
      await mkdir(join(deps.stateDir, "ops"), { recursive: true });
      await appendFile(join(deps.stateDir, "ops", "degraded.jsonl"), `${JSON.stringify({ at: now(), projectId: event.scope.projectId, reason: action.summary })}\n`, "utf8");
      return "已写降级标记 ops/degraded.jsonl";
    },
    retry: async (_action, event) => {
      if (event.kind === RUNBOOK_EVENT_KINDS.opsMissed && event.scope.playbookId) {
        const result = deps.launch(["ops", "run-playbook", event.scope.playbookId, "--repo", deps.repoRoot]);
        return `已补跑 run-playbook pid=${result.pid}`;
      }
      if (event.kind === RUNBOOK_EVENT_KINDS.mergeGuardRed && event.scope.flowId) {
        const result = deps.launch(["merge", event.scope.flowId, "--actor", "machine"]);
        return `已复跑合并门 pid=${result.pid}`;
      }
      if (event.kind === RUNBOOK_EVENT_KINDS.outboxPushFailed) {
        const push = deps.push ?? ((base: string) => pushIfRemoteBehind(deps.repoRoot, base));
        const result = await flushOutbox(deps.repoRoot, "ops", (payload) => push(payload.keyLocation ?? "main"));
        if (result.failed > 0) throw new Error(`outbox 重放仍有 ${result.failed} 条失败（远端超前或推送被拒）`);
        return `outbox 已重放 ${result.flushed} 条`;
      }
      throw new Error(`没有 ${event.kind} 的重试执行器`);
    },
  };
}
