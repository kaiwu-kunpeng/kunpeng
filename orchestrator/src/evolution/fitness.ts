import { aggregateSavings, type FlowLike } from "../metrics/time-saved.js";
import type { CostReport } from "../runtime/cost-report.js";

export interface FitnessSnapshot {
  netSavedHours: number;
  verifiedDevFlows: number;
  totalUsd: number;
  totalTokens: number;
}

export interface FitnessDelta {
  netSavedHoursDelta: number;
  usdDelta: number;
  verifiedDevFlowsDelta: number;
  regressions: string[];
  improved: boolean;
}

export function fitnessSnapshot(flows: FlowLike[], costs?: CostReport[]): FitnessSnapshot {
  const roll = aggregateSavings(flows);
  let totalUsd = 0;
  let totalTokens = 0;

  for (const report of costs ?? []) {
    totalUsd += report.cost?.totalUsd ?? 0;
    totalTokens += report.totalTokens ?? 0;
  }

  return {
    netSavedHours: roll.netSavedHours,
    verifiedDevFlows: roll.verifiedDevFlows,
    totalUsd,
    totalTokens,
  };
}

export function compareFitness(baseline: FitnessSnapshot, candidate: FitnessSnapshot): FitnessDelta {
  const netSavedHoursDelta = candidate.netSavedHours - baseline.netSavedHours;
  const usdDelta = candidate.totalUsd - baseline.totalUsd;
  const verifiedDevFlowsDelta = candidate.verifiedDevFlows - baseline.verifiedDevFlows;
  const regressions: string[] = [];

  if (verifiedDevFlowsDelta < 0) {
    regressions.push("verifiedDevFlows 下降");
  }
  // 成本非回归用「效率」(USD / 净省工时h)，不用累计绝对值：累计成本必单调上涨，
  // 拿累计 Δ 当回归会让门每轮恒触发、毫无意义。效率恶化 = USD 涨得比价值快，才算真回归。
  const baseEff = baseline.netSavedHours > 0 ? baseline.totalUsd / baseline.netSavedHours : 0;
  const candEff = candidate.netSavedHours > 0 ? candidate.totalUsd / candidate.netSavedHours : 0;
  if (candEff > baseEff + 1e-9) {
    regressions.push("成本效率恶化(USD/净省工时h ↑)");
  }

  return {
    netSavedHoursDelta,
    usdDelta,
    verifiedDevFlowsDelta,
    regressions,
    improved: netSavedHoursDelta > 0 && regressions.length === 0,
  };
}
