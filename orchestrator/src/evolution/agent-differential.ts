import { renderEvalReport, type EvalReport, type ReplayResult } from "./eval-report.js";
import type { RegressionTask } from "./regression-store.js";

export interface AgentAttempt {
  passed: boolean;
  ms: number;
}

export interface AgentDifferentialConfig {
  tasks: RegressionTask[];
  baselineCwd: string;
  candidateCwd: string;
  baselineRules: string;
  candidateRules: string;
  runAttempt: (task: RegressionTask, rules: string, cwd: string) => Promise<AgentAttempt>;
  now?: () => number;
}

export async function runAgentDifferential(
  config: AgentDifferentialConfig,
): Promise<{ replay: ReplayResult; report: EvalReport }> {
  const measuredAt = (config.now ?? Date.now)();
  const outcomes: ReplayResult["tasks"] = [];
  let baselinePassedCount = 0;
  let candidatePassedCount = 0;
  let candidateMsTotal = 0;

  for (const task of config.tasks) {
    const baselineAttempt = await config.runAttempt(task, config.baselineRules, config.baselineCwd);
    const candidateAttempt = await config.runAttempt(task, config.candidateRules, config.candidateCwd);

    if (baselineAttempt.passed) baselinePassedCount += 1;
    if (candidateAttempt.passed) candidatePassedCount += 1;
    candidateMsTotal += candidateAttempt.ms;

    outcomes.push({
      id: task.id,
      acceptanceCmd: task.acceptanceCmd,
      baselinePassed: baselineAttempt.passed,
      candidatePassed: candidateAttempt.passed,
      ms: candidateAttempt.ms,
    });
  }

  const taskCount = config.tasks.length;
  const replay: ReplayResult = {
    baselinePassK: taskCount === 0 ? 0 : baselinePassedCount / taskCount,
    candidatePassK: taskCount === 0 ? 0 : candidatePassedCount / taskCount,
    costPerResolvedTask: candidatePassedCount === 0 ? 0 : candidateMsTotal / candidatePassedCount,
    tasks: outcomes,
    measuredAt,
  };

  return {
    replay,
    report: renderEvalReport(replay, { generatedAt: measuredAt }),
  };
}
