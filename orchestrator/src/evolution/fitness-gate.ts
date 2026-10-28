import type { FitnessSnapshot, FitnessDelta } from "./fitness.js";

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${round1(n)}`;
}

/** 真适应度裁决：净省工时↑且无回归即放行。纯函数，无 I/O。 */
export function fitnessVerdict(delta: FitnessDelta): { pass: boolean; reason: string } {
  if (delta.improved) {
    return { pass: true, reason: `净省工时 Δ ${signed(delta.netSavedHoursDelta)}h 放行` };
  }
  if (delta.regressions.length) {
    return { pass: false, reason: `拦截：${delta.regressions.join("、")}` };
  }
  return { pass: false, reason: `拦截：净省工时未增（Δ ${signed(delta.netSavedHoursDelta)}h）` };
}

/** 系统适应度快照的一行可读摘要（落知识库 / 展示）。纯函数。 */
export function summarizeFitness(s: FitnessSnapshot): string {
  return `净省 ${round1(s.netSavedHours)}h · verified dev flow ${s.verifiedDevFlows} · token ${s.totalTokens}`;
}
