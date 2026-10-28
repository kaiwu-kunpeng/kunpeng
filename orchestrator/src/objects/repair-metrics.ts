export interface RepairAttemptSample {
  status?: string;
  repairAttempts?: number;
  repairAttemptTokens?: Record<string, number>;
}

export interface RepairAttemptRow {
  attempt: number;
  flows: number;
  tokens: number;
  recovered: number;
  recoveryRate: number;
}

function repairAttemptCount(sample: RepairAttemptSample): number {
  const value = sample.repairAttempts;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function summarizeRepairAttempts(
  samples: readonly RepairAttemptSample[],
): RepairAttemptRow[] {
  const maxAttempt = samples.reduce(
    (max, sample) => Math.max(max, repairAttemptCount(sample)),
    0,
  );
  const rows: RepairAttemptRow[] = [];

  for (let attempt = 1; attempt <= maxAttempt; attempt++) {
    const attemptedFlows = samples.filter(
      (sample) => repairAttemptCount(sample) >= attempt,
    );
    const flows = attemptedFlows.length;
    if (flows === 0) continue;

    const tokens = attemptedFlows.reduce((sum, sample) => {
      const value = sample.repairAttemptTokens?.[String(attempt)];
      return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
    const recovered = attemptedFlows.filter(
      (sample) => sample.status === "verified" && sample.repairAttempts === attempt,
    ).length;

    rows.push({
      attempt,
      flows,
      tokens,
      recovered,
      recoveryRate: flows === 0 ? 0 : recovered / flows,
    });
  }

  return rows;
}

export function renderRepairAttemptReport(rows: readonly RepairAttemptRow[]): string {
  if (rows.length === 0) return "暂无重试数据";
  return rows
    .map((row) =>
      `第 ${row.attempt} 次  流数 ${row.flows}  tokens ${row.tokens}  救回 ${row.recovered}  ${(row.recoveryRate * 100).toFixed(1)}%`,
    )
    .join("\n");
}
