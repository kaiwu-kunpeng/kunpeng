import type { DifferentialEvalDeps } from "./eval-runner.js";
import type { RegressionTask } from "./regression-store.js";

export interface DiffDepsConfig {
  listHoldout: () => Promise<RegressionTask[]>;
  runAcceptance: (cmd: string, cwd: string) => Promise<{ passed: boolean; ms: number }>;
  baselineCwd: string;
  candidateCwd: string;
}

export function buildDifferentialEvalDeps(config: DiffDepsConfig): DifferentialEvalDeps {
  return {
    listHoldout: config.listHoldout,
    runBaseline: (cmd, _cwd) => config.runAcceptance(cmd, config.baselineCwd),
    runCandidate: (cmd, _cwd) => config.runAcceptance(cmd, config.candidateCwd),
    cwd: config.baselineCwd,
  };
}
