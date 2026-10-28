import { renderEvalReport, type EvalReport, type EvalReportMeta, type ReplayResult as EvalReportReplay } from "./eval-report.js";
import { replayHoldout, type ReplayResult as ReplayRunResult } from "./eval-replay.js";
import type { DifferentialEvalDeps } from "./eval-runner.js";

export async function runEvalCurve(
  deps: DifferentialEvalDeps,
  meta?: EvalReportMeta,
): Promise<{ replay: ReplayRunResult; report: EvalReport }> {
  const replay = await replayHoldout(deps);
  const tasks = await deps.listHoldout();
  const cmdById = new Map(tasks.map((task) => [task.id, task.acceptanceCmd]));

  const reportInput: EvalReportReplay = {
    baselinePassK: replay.baselinePassK,
    candidatePassK: replay.candidatePassK,
    pairedDelta: replay.pairedDelta,
    pairedStdError: replay.pairedStdError,
    discernible: replay.discernible,
    costPerResolvedTask: replay.costPerResolvedTask,
    tasks: replay.perTask.map((task) => ({
      id: task.taskId,
      acceptanceCmd: cmdById.get(task.taskId) ?? "",
      baselinePassed: task.baselinePassed,
      candidatePassed: task.candidatePassed,
      ms: task.ms,
    })),
  };

  const report = renderEvalReport(reportInput, meta);
  return { replay, report };
}
