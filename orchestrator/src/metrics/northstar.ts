import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GateLedgerEntry } from "../runtime/flowstate.js";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const execFileAsync = promisify(execFile);

export type MergeKind = "machine" | "agent" | "human" | "unknown" | "bypass";

export interface NorthstarFlow {
  flowId: string;
  planId?: string;
  gateLedger?: GateLedgerEntry[];
  mergedBy?: { by: string; at: number };
  startedBy?: { by: string };
  startedAt?: number;
  history?: { stage: string }[];
  sensitive?: { hits: unknown[] };
}

export function classifyMerge(
  flowId: string,
  flows: NorthstarFlow[],
): { kind: MergeKind; humanTouches: number; sensitive: boolean } {
  const group = flows.filter((flow) => flow.flowId === flowId || flow.planId === flowId);
  const entries = group.flatMap((flow) => flow.gateLedger ?? []);
  const merges = group.flatMap((flow) => flow.mergedBy ? [flow.mergedBy] : []);
  const humanTouches = entries.length === 0 && merges.some((merge) => merge.by === "human")
    ? 1 : entries.filter((entry) => entry.by === "human").length;
  const sensitive = group.some((flow) => (flow.sensitive?.hits.length ?? 0) > 0);
  if (entries.length === 0 && merges.length === 0) {
    const cleared = group.some((flow) => flow.history?.some((entry) => entry.stage === "gate-cleared"));
    return { kind: cleared ? "unknown" : "bypass", humanTouches, sensitive };
  }
  if (humanTouches > 0) return { kind: "human", humanTouches, sensitive };
  const evidence = [...entries.map((entry) => ({ by: entry.by, at: entry.closedAt })), ...merges];
  const latest = evidence.reduce((last, entry) => entry.at > last.at ? entry : last);
  const kind = latest.by === "machine" || latest.by === "agent" ? latest.by : "unknown";
  return { kind, humanTouches, sensitive };
}

function isMachineOriginMerge(flowId: string, flows: NorthstarFlow[], reverted: Set<string>): boolean {
  if (reverted.has(flowId)) return false;
  const group = flows.filter((flow) => flow.flowId === flowId || flow.planId === flowId);
  return group.some((flow) => flow.startedBy?.by === "machine")
    && group.some((flow) => flow.history?.some((entry) => entry.stage === "implement"));
}

export interface NorthstarWeek {
  weekStart: number;
  weekEnd: number;
  merges: number;
  machine: number;
  machineOrigin: number;
  agent: number;
  human: number;
  unknown: number;
  bypass: number;
  humanTouches: number;
  reverted: number;
  sensitiveByMachine: number;
  sensitiveByAgent: number;
  sensitiveByHuman: number;
  northstar: number;
  pendingMaturity: number;
}

export function buildNorthstar(
  merges: { flowId: string; mergedAt: number }[],
  revertedFlowIds: string[],
  flows: NorthstarFlow[],
  opts: { now: number; weeks: number },
): NorthstarWeek[] {
  const reverted = new Set(revertedFlowIds);
  return Array.from({ length: opts.weeks }, (_, index) => {
    const week: NorthstarWeek = {
      weekStart: opts.now - (opts.weeks - index) * WEEK,
      weekEnd: opts.now - (opts.weeks - index - 1) * WEEK,
      merges: 0,
      machine: 0,
      machineOrigin: 0,
      agent: 0,
      human: 0,
      unknown: 0,
      bypass: 0,
      humanTouches: 0,
      reverted: 0,
      sensitiveByMachine: 0,
      sensitiveByAgent: 0,
      sensitiveByHuman: 0,
      northstar: 0,
      pendingMaturity: 0,
    };
    for (const merge of merges) {
      if (merge.mergedAt < week.weekStart || merge.mergedAt >= week.weekEnd) continue;
      const classification = classifyMerge(merge.flowId, flows);
      week.merges++;
      if (isMachineOriginMerge(merge.flowId, flows, reverted)) week.machineOrigin++;
      week[classification.kind]++;
      week.humanTouches += classification.humanTouches;
      if (classification.sensitive) {
        if (classification.kind === "machine") week.sensitiveByMachine++;
        if (classification.kind === "agent") week.sensitiveByAgent++;
        if (classification.kind === "human") week.sensitiveByHuman++;
      }
      if (reverted.has(merge.flowId)) {
        week.reverted++;
      } else if (classification.kind === "machine" || classification.kind === "agent") {
        if (opts.now - merge.mergedAt >= 14 * DAY) week.northstar++;
        else week.pendingMaturity++;
      }
    }
    return week;
  });
}

export interface StopLoss {
  observedSince: number | null;
  observedDays: number;
  machineOriginMerges: number;
  triggered: boolean;
}

export function judgeStopLoss(
  merges: { flowId: string; mergedAt: number }[],
  revertedFlowIds: string[],
  flows: NorthstarFlow[],
  opts: { now: number; windowDays?: number; minMerges?: number },
): StopLoss {
  const { now, windowDays = 42, minMerges = 3 } = opts;
  let observedSince: number | null = null;
  for (const flow of flows) {
    if (!flow.startedBy || flow.startedAt === undefined || !Number.isFinite(flow.startedAt)) continue;
    observedSince = observedSince === null ? flow.startedAt : Math.min(observedSince, flow.startedAt);
  }
  if (observedSince === null) {
    return { observedSince: null, observedDays: 0, machineOriginMerges: 0, triggered: false };
  }
  const observedDays = Math.floor((now - observedSince) / DAY);
  const windowStart = Math.max(observedSince, now - windowDays * DAY);
  const reverted = new Set(revertedFlowIds);
  const machineOriginMerges = merges.filter((merge) =>
    merge.mergedAt >= windowStart && merge.mergedAt < now
    && isMachineOriginMerge(merge.flowId, flows, reverted),
  ).length;
  return { observedSince, observedDays, machineOriginMerges, triggered: observedDays >= windowDays && machineOriginMerges < minMerges };
}

export async function gitLogsForNorthstar(
  repoRoot: string,
  ref = "main",
): Promise<{ mergedLog: string; revertLog: string }> {
  try {
    const [merged, revert] = await Promise.all([
      execFileAsync("git", ["log", "--merges", "--first-parent", "--format=%ct|%s", ref], {
        cwd: repoRoot,
        timeout: 30_000,
      }),
      execFileAsync("git", ["log", "--format=%s", ref], {
        cwd: repoRoot,
        timeout: 30_000,
      }),
    ]);
    return { mergedLog: merged.stdout, revertLog: revert.stdout };
  } catch {
    return { mergedLog: "", revertLog: "" };
  }
}

export function formatNorthstarReport(weeks: NorthstarWeek[], label?: string, stopLoss?: StopLoss): string {
  const title = "北极星：无人介入且满 14 天未 revert 的合入／周";
  const lines = [label === undefined ? title : `${title}（${label}）`];
  for (const week of weeks) {
    lines.push([
      new Date(week.weekStart).toISOString().slice(0, 10),
      `北极星 ${week.northstar}`,
      `待满14天 ${week.pendingMaturity}`,
      `人工介入 ${week.humanTouches}`,
      `绕门 ${week.bypass}`,
      `revert ${week.reverted}`,
      `敏感合入 machine ${week.sensitiveByMachine}/agent ${week.sensitiveByAgent}/human ${week.sensitiveByHuman}`,
      `机器来源 ${week.machineOrigin}`,
    ].join(" ｜ "));
  }
  if (weeks.some((week) => week.sensitiveByMachine > 0)) {
    lines.push("⚠️ 机器自动合入了敏感改动");
  }
  if (stopLoss !== undefined) {
    const verdict = stopLoss.observedDays < 42 ? "观测未满 42 天，暂不判定"
      : stopLoss.triggered ? "🛑 已触发：停止投入机器环，降为每月批跑" : "未触发";
    lines.push(`机器环止损线：近 42 天机器来源非琐碎合入 ${stopLoss.machineOriginMerges} 条 ｜ 已观测 ${stopLoss.observedDays} 天 ｜ ${verdict}`);
  }
  return lines.join("\n");
}
