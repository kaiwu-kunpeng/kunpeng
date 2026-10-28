export interface StageCostRow {
  stage: string;
  tokens: number;
  share: number;
}

export function buildStageCostRows(
  stageTotals: Readonly<Record<string, number>>,
): StageCostRow[] {
  const entries = Object.entries(stageTotals).filter(
    (entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0,
  );
  const total = entries.reduce((sum, [, tokens]) => sum + tokens, 0);

  return entries
    .map(([stage, tokens]) => ({
      stage,
      tokens,
      share: total === 0 ? 0 : tokens / total,
    }))
    .sort((left, right) => right.tokens - left.tokens);
}

export function renderStageCostReport(
  rows: readonly StageCostRow[],
  coverage: { total: number; withTokens: number; coverage: number },
): string {
  const lines = rows.length === 0
    ? ["暂无阶段数据"]
    : rows.map((row) => `${row.stage}  ${row.tokens}  ${(row.share * 100).toFixed(1)}%`);
  lines.push(`覆盖率  ${coverage.withTokens}/${coverage.total}  ${(coverage.coverage * 100).toFixed(1)}%`);
  return lines.join("\n");
}
