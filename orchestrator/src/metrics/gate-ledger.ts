import type { FlowState, GateLedgerEntry } from "../runtime/flowstate.js";

export interface GateStatsWindow {
  sinceMs: number;
  untilMs: number;
}

export interface GateStats {
  sinceMs: number;
  untilMs: number;
  weeks: number;
  human: number;
  agent: number;
  machine: number;
  unknown: number;
  planGates: number;
  humanPerWeek: number;
  agentPerWeek: number;
  machinePerWeek: number;
  medianHumanDurationMs: number | null;
  tiers: { short: number; medium: number; long: number; unset: number };
  openNow: number;
}

export function collectGateLedger(
  flows: readonly Pick<FlowState, "flowId" | "gateLedger">[],
  window: GateStatsWindow,
): GateLedgerEntry[] {
  return flows.flatMap((flow) => flow.gateLedger ?? [])
    .filter((entry) => window.sinceMs <= entry.closedAt && entry.closedAt < window.untilMs)
    .sort((a, b) => a.closedAt - b.closedAt);
}

export function buildGateStats(
  flows: readonly Pick<FlowState, "flowId" | "gateLedger" | "humanGate">[],
  window: GateStatsWindow,
): GateStats {
  const entries = collectGateLedger(flows, window);
  const weeks = Math.max((window.untilMs - window.sinceMs) / 604_800_000, 1 / 7);
  const humans = entries.filter((entry) => entry.by === "human");
  const human = humans.length;
  const agent = entries.filter((entry) => entry.by === "agent").length;
  const machine = entries.filter((entry) => entry.by === "machine").length;
  const durations = humans.map((entry) => entry.durationMs).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const medianHumanDurationMs = durations.length === 0 ? null
    : durations.length % 2 === 1 ? durations[middle]
    : (durations[middle - 1] + durations[middle]) / 2;
  const tiers = { short: 0, medium: 0, long: 0, unset: 0 };
  for (const entry of humans) tiers[entry.durationTier ?? "unset"]++;
  return {
    sinceMs: window.sinceMs,
    untilMs: window.untilMs,
    weeks,
    human,
    agent,
    machine,
    unknown: entries.filter((entry) => entry.by === "unknown").length,
    planGates: entries.filter((entry) => entry.planGate === true).length,
    humanPerWeek: Math.round(human / weeks * 10) / 10,
    agentPerWeek: Math.round(agent / weeks * 10) / 10,
    machinePerWeek: Math.round(machine / weeks * 10) / 10,
    medianHumanDurationMs,
    tiers,
    openNow: flows.filter((flow) => flow.humanGate).length,
  };
}

export function formatGateStatsReport(stats: GateStats, label?: string): string {
  const median = stats.medianHumanDurationMs === null
    ? "无数据" : `${(stats.medianHumanDurationMs / 60_000).toFixed(1)} 分钟`;
  return [
    `【门账本${label ? ` · ${label}` : ""}】`,
    `统计窗口：${new Date(stats.sinceMs).toISOString()} ≤ 清门时间 < ${new Date(stats.untilMs).toISOString()}`,
    `人批的门/周：${stats.humanPerWeek}（共 ${stats.human} 扇）`,
    `机器自动清的门/周：${stats.machinePerWeek}（共 ${stats.machine} 扇）`,
    `agent 代点的门/周：${stats.agentPerWeek}（共 ${stats.agent} 扇）`,
    `每扇门时长中位（人批，开门至清门）：${median}`,
    `父流的门：${stats.planGates}（已计入各归因类别）`,
    `未归因：${stats.unknown}`,
    `人批耗时自报：≤5 分钟 ${stats.tiers.short}；5–15 分钟 ${stats.tiers.medium}；>15 分钟 ${stats.tiers.long}；未填写 ${stats.tiers.unset}`,
    `当前未清的门：${stats.openNow}`,
  ].join("\n");
}
