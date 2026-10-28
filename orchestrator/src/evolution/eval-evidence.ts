import type { ProposalEvidence } from "../loop/self-evolution.js";
import type { ReplayResult } from "./eval-report.js";

export function evidenceFromAgentDifferential(replay: ReplayResult): ProposalEvidence {
  return {
    holdoutPassK: replay.candidatePassK,
    costPerResolvedTask: replay.costPerResolvedTask,
    baseline: {
      holdoutPassK: replay.baselinePassK,
    },
    measuredAt: replay.measuredAt,
  };
}
