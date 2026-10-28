import type { FlowRecord } from "./escape-rate.js";

export function parseMergedRecordsFromGitLog(log: string): FlowRecord[] {
  const records: FlowRecord[] = [];

  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = parseTimestampedSubject(line);
    if (parsed === undefined) continue;

    const flowId = parseMergedFlowId(parsed.subject);
    if (flowId === undefined) continue;

    records.push({
      flowId,
      merged: true,
      reverted: false,
      mergedAt: parsed.committedAtSeconds * 1000,
    });
  }

  return records;
}

export function parseRevertedFlowIds(log: string): string[] {
  const flowIds = new Set<string>();

  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const subject = parseTimestampedSubject(line)?.subject ?? line;
    const flowId = parseRevertedFlowId(subject);
    if (flowId !== undefined) flowIds.add(flowId);
  }

  return [...flowIds];
}

export function mergeRevertSignals(
  mergedRecords: FlowRecord[],
  gitRevertedFlowIds: string[],
  flowStateRevertedFlowIds: string[],
): FlowRecord[] {
  const reverted = new Set([...gitRevertedFlowIds, ...flowStateRevertedFlowIds]);

  return mergedRecords.map((record) => ({
    ...record,
    reverted: record.reverted || reverted.has(record.flowId),
  }));
}

function parseTimestampedSubject(line: string): { committedAtSeconds: number; subject: string } | undefined {
  const match = line.match(/^(\d+)(?:\||\s+)(.+)$/);
  if (!match) return undefined;

  const committedAtSeconds = Number(match[1]);
  if (!Number.isFinite(committedAtSeconds)) return undefined;

  return {
    committedAtSeconds,
    subject: match[2].trim(),
  };
}

function parseMergedFlowId(subject: string): string | undefined {
  const match = subject.match(/^Merge branch 'kp\/([^']+)'(?:\s|$)/);
  return match?.[1];
}

function parseRevertedFlowId(subject: string): string | undefined {
  const kpSubject = subject.match(/^Revert "kp\(([^)]+)\):/);
  if (kpSubject) return kpSubject[1];

  const mergeSubject = subject.match(/^Revert "Merge branch 'kp\/([^']+)'(?:\s|")/);
  return mergeSubject?.[1];
}
