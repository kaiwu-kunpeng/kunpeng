import { evaluateProposalDifferential, type DifferentialEvalDeps } from "./eval-runner.js";

export interface PerTaskReplay {
  taskId: string;
  iterations: number;
  baselinePassCount: number;
  candidatePassCount: number;
  baselinePassed: boolean;
  candidatePassed: boolean;
  unstable: boolean;
  ms: number;
}

export interface ReplayResult {
  perTask: PerTaskReplay[];
  baselinePassK: number;
  candidatePassK: number;
  delta: number;
  pairedDelta: number;
  pairedStdError: number;
  discernible: boolean;
  costPerResolvedTask: number;
  unstableTaskIds: string[];
}

function calculatePairedStatistics(perTask: PerTaskReplay[]): {
  pairedDelta: number;
  pairedStdError: number;
  discernible: boolean;
} {
  const n = perTask.length;
  if (n === 0) {
    return { pairedDelta: 0, pairedStdError: 0, discernible: false };
  }

  const differences = perTask.map((task) => (
    task.candidatePassCount / task.iterations
    - task.baselinePassCount / task.iterations
  ));
  const pairedDelta = differences.reduce((sum, difference) => sum + difference, 0) / n;

  if (n === 1) {
    return { pairedDelta, pairedStdError: 0, discernible: false };
  }

  const squaredDeviationSum = differences.reduce(
    (sum, difference) => sum + (difference - pairedDelta) ** 2,
    0,
  );
  const pairedStdError = Math.sqrt(squaredDeviationSum / (n - 1)) / Math.sqrt(n);

  return {
    pairedDelta,
    pairedStdError,
    discernible: Math.abs(pairedDelta) > 1.96 * pairedStdError,
  };
}

export async function replayHoldout(
  deps: DifferentialEvalDeps,
  opts?: { iterations?: number },
): Promise<ReplayResult> {
  const tasks = await deps.listHoldout();
  const iterations = Math.max(1, opts?.iterations ?? 1);

  if (tasks.length === 0) {
    return {
      perTask: [],
      baselinePassK: 0,
      candidatePassK: 0,
      delta: 0,
      pairedDelta: 0,
      pairedStdError: 0,
      discernible: false,
      costPerResolvedTask: 0,
      unstableTaskIds: [],
    };
  }

  const perTask: PerTaskReplay[] = [];
  for (const task of tasks) {
    let baselinePassCount = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const baseline = await deps.runBaseline(task.acceptanceCmd, deps.cwd);
      if (baseline.passed) baselinePassCount += 1;
    }

    let candidatePassCount = 0;
    let ms = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const candidate = await deps.runCandidate(task.acceptanceCmd, deps.cwd);
      if (candidate.passed) candidatePassCount += 1;
      ms = candidate.ms;
    }

    const unstable = (
      (baselinePassCount !== 0 && baselinePassCount !== iterations)
      || (candidatePassCount !== 0 && candidatePassCount !== iterations)
    );

    perTask.push({
      taskId: task.id,
      iterations,
      baselinePassCount,
      candidatePassCount,
      baselinePassed: baselinePassCount * 2 > iterations,
      candidatePassed: candidatePassCount * 2 > iterations,
      unstable,
      ms,
    });
  }

  const evidence = await evaluateProposalDifferential(deps);
  const candidatePassK = evidence.holdoutPassK;
  const baselinePassK = evidence.baseline?.holdoutPassK ?? 0;
  const pairedStatistics = calculatePairedStatistics(perTask);

  return {
    perTask,
    baselinePassK,
    candidatePassK,
    delta: candidatePassK - baselinePassK,
    ...pairedStatistics,
    costPerResolvedTask: evidence.costPerResolvedTask,
    unstableTaskIds: perTask
      .filter((task) => task.unstable)
      .map((task) => task.taskId),
  };
}
