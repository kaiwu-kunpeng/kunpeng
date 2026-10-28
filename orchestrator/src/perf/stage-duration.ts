import { buildPerfProfile, type PerfProfile } from "./perf-sample.js";

export interface StageHistoryEntry {
  stage: string;
  at: number;
}

export interface StageDurationFlow {
  history?: StageHistoryEntry[];
  updatedAt?: number;
}

export function aggregateStageDurations(
  flows: StageDurationFlow[],
  now: number,
): Record<string, number> {
  const durations: Record<string, number> = {};

  for (const flow of flows) {
    const history = (flow.history ?? []).slice().sort((left, right) => left.at - right.at);

    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const next = history[i + 1];
      const end = next ? next.at : (flow.updatedAt || now);
      const stage = entry.stage === "done" ? "commit" : entry.stage;
      durations[stage] = (durations[stage] ?? 0) + Math.max(0, end - entry.at);
    }
  }

  return durations;
}

export function buildStageBottlenecks(
  durations: Record<string, number>,
  tokens?: Record<string, number>,
  topN?: number,
): PerfProfile {
  const samples = Object.entries(durations).map(([stage, ms]) => ({
    label: stage,
    ms,
    bytes: tokens?.[stage],
  }));

  return buildPerfProfile(samples, { by: "ms", topN: topN ?? 5 });
}
