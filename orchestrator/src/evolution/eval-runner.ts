// 当前实现只诚实报告“本批 holdout 当前可靠率”：baseline 与 candidate 相同，不做差分；
// 后续可深化为历史基线或对照组比较。
import type { ProposalEvidence } from "../loop/self-evolution.js";
import type { RegressionTask } from "./regression-store.js";

export interface EvalDeps {
  listHoldout: () => Promise<RegressionTask[]>;
  runAcceptance: (cmd: string, cwd: string) => Promise<{ passed: boolean; ms: number }>;
  cwd: string;
  now: () => number;
}

export interface DifferentialEvalDeps {
  listHoldout: () => Promise<RegressionTask[]>;
  runBaseline: (cmd: string, cwd: string) => Promise<{ passed: boolean; ms: number }>;
  runCandidate: (cmd: string, cwd: string) => Promise<{ passed: boolean; ms: number }>;
  cwd: string;
}

export async function evaluateHoldoutReliability(deps: EvalDeps): Promise<ProposalEvidence> {
  const tasks = await deps.listHoldout();

  if (tasks.length === 0) {
    return {
      holdoutPassK: 0,
      costPerResolvedTask: 0,
      baseline: {
        holdoutPassK: 0,
        costPerResolvedTask: 0,
      },
      measuredAt: deps.now(),
    };
  }

  let passCount = 0;
  let passedMs = 0;
  for (const task of tasks) {
    const result = await deps.runAcceptance(task.acceptanceCmd, deps.cwd);
    if (result.passed) {
      passCount += 1;
      passedMs += result.ms;
    }
  }

  const rate = passCount / tasks.length;
  const cost = passCount > 0 ? passedMs / passCount : 0;

  return {
    holdoutPassK: rate,
    costPerResolvedTask: cost,
    baseline: {
      holdoutPassK: rate,
      costPerResolvedTask: cost,
    },
    measuredAt: deps.now(),
  };
}

export async function evaluateProposalDifferential(deps: DifferentialEvalDeps): Promise<ProposalEvidence> {
  const tasks = await deps.listHoldout();

  if (tasks.length === 0) {
    return {
      holdoutPassK: 0,
      costPerResolvedTask: 0,
      baseline: {
        holdoutPassK: 0,
      },
    };
  }

  let baselinePassed = 0;
  let candidatePassed = 0;
  let candidateTotalMs = 0;

  for (const task of tasks) {
    const baseline = await deps.runBaseline(task.acceptanceCmd, deps.cwd);
    const candidate = await deps.runCandidate(task.acceptanceCmd, deps.cwd);

    if (baseline.passed) {
      baselinePassed += 1;
    }
    if (candidate.passed) {
      candidatePassed += 1;
    }
    candidateTotalMs += candidate.ms;
  }

  return {
    holdoutPassK: candidatePassed / tasks.length,
    costPerResolvedTask: candidatePassed > 0 ? candidateTotalMs / candidatePassed : 0,
    baseline: {
      holdoutPassK: baselinePassed / tasks.length,
    },
  };
}
