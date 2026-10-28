import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseMergedRecordsFromGitLog,
  parseRevertedFlowIds,
  mergeRevertSignals,
} from "./flow-records.js";
import {
  computeEscapeRate,
  computeEscapeRateByWindow,
  type EscapeRate,
} from "./escape-rate.js";

const execFileAsync = promisify(execFile);

export function rolledBackFlowIdsFromStates(
  states: { flowId: string; status: string }[],
): string[] {
  const seen = new Set<string>();
  const rolledBackFlowIds: string[] = [];

  for (const state of states) {
    if (state.status !== "rolled-back") continue;
    if (seen.has(state.flowId)) continue;

    seen.add(state.flowId);
    rolledBackFlowIds.push(state.flowId);
  }

  return rolledBackFlowIds;
}

export function buildEscapeRateFromLogs(
  mergedLog: string,
  revertLog: string,
  rolledBackFlowIds: string[],
  opts?: { windowMs?: number; now?: number },
): EscapeRate {
  const merged = parseMergedRecordsFromGitLog(mergedLog);
  const reverted = parseRevertedFlowIds(revertLog);
  const records = mergeRevertSignals(merged, reverted, rolledBackFlowIds);

  if (opts?.windowMs === undefined) {
    return computeEscapeRate(records);
  }

  return computeEscapeRateByWindow(
    records,
    opts.windowMs,
    opts.now ?? Date.now(),
  );
}

export function formatEscapeRateReport(
  er: EscapeRate,
  opts?: { windowLabel?: string },
): string {
  const title = opts?.windowLabel
    ? `逃逸率报告（${opts.windowLabel}）`
    : "逃逸率报告";
  const lines = [
    title,
    `逃逸率：${(er.rate * 100).toFixed(1)}%`,
    `合并：${er.mergedCount}`,
    `逃逸：${er.escapedCount}`,
  ];

  if (er.escapedFlowIds.length > 0) {
    lines.push("逃逸 flowId：");
    for (const flowId of er.escapedFlowIds) {
      lines.push(`- ${flowId}`);
    }
  }

  return lines.join("\n");
}

export async function gitLogsForEscapeRate(
  repoRoot: string,
  ref = "main",
): Promise<{ mergedLog: string; revertLog: string }> {
  try {
    const [merged, revert] = await Promise.all([
      execFileAsync("git", ["log", "--merges", "--format=%ct|%s", ref], {
        cwd: repoRoot,
      }),
      execFileAsync("git", ["log", "--format=%s", ref], { cwd: repoRoot }),
    ]);

    return {
      mergedLog: merged.stdout,
      revertLog: revert.stdout,
    };
  } catch {
    return { mergedLog: "", revertLog: "" };
  }
}
