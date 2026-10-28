export interface PerfMetrics {
  lcpMs: number;
  cls: number;
  tbtMs: number;
  totalBytes: number;
}

export interface PerfBudget {
  lcpMs: number;
  cls: number;
  tbtMs: number;
  totalBytes: number;
}

// Core Web Vitals "good" baselines plus a default page weight cap; callers may override them.
export const DEFAULT_PERF_BUDGET: PerfBudget = {
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200,
  totalBytes: 1_600_000,
};

const PERF_KEYS = ["lcpMs", "cls", "tbtMs", "totalBytes"] as const;

export function decidePerf(
  metrics: PerfMetrics,
  budget: PerfBudget = DEFAULT_PERF_BUDGET,
): { withinBudget: boolean; overages: string[] } {
  const overages = PERF_KEYS.flatMap((key) =>
    metrics[key] > budget[key] ? [`${key} ${metrics[key]} > ${budget[key]}`] : [],
  );

  return { withinBudget: overages.length === 0, overages };
}
