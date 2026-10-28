export interface FlowRecord {
  flowId: string;
  merged: boolean;
  reverted: boolean;
  mergedAt?: number;
}

export interface EscapeRate {
  mergedCount: number;
  escapedCount: number;
  rate: number;
  escapedFlowIds: string[];
}

export function computeEscapeRate(records: FlowRecord[]): EscapeRate {
  let mergedCount = 0;
  const escapedFlowIds: string[] = [];

  for (const record of records) {
    if (!record.merged) continue;

    mergedCount += 1;
    if (record.reverted) {
      escapedFlowIds.push(record.flowId);
    }
  }

  const escapedCount = escapedFlowIds.length;

  return {
    mergedCount,
    escapedCount,
    rate: mergedCount > 0 ? escapedCount / mergedCount : 0,
    escapedFlowIds,
  };
}

export function computeEscapeRateByWindow(
  records: FlowRecord[],
  windowMs: number,
  now: number,
): EscapeRate {
  const windowStart = now - windowMs;
  const scopedRecords = records.filter(
    (record) =>
      record.mergedAt !== undefined &&
      record.mergedAt > windowStart &&
      record.mergedAt <= now,
  );

  return computeEscapeRate(scopedRecords);
}
