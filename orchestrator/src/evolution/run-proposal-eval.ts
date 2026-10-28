import type { ArtifactStore } from "../artifacts/store.js";
import type { ProposalEvidence, ProposedChange } from "../loop/self-evolution.js";
import { type AgentAttempt, runAgentDifferential } from "./agent-differential.js";
import { attachEvidence } from "./eval-deps.js";
import { evidenceFromAgentDifferential } from "./eval-evidence.js";
import type { RegressionTask } from "./regression-store.js";

export interface ProposalEvalDeps {
  store: ArtifactStore;
  loadProposalChanges: (id: string) => Promise<ProposedChange[] | null>;
  listHoldout: () => Promise<RegressionTask[]>;
  baselineRules: string;
  candidateRulesFor: (changes: ProposedChange[]) => string;
  prepareWorktrees: (task0?: RegressionTask) => Promise<{
    baselineCwd: string;
    candidateCwd: string;
    cleanup: () => Promise<void>;
  }>;
  runAttempt: (task: RegressionTask, rules: string, cwd: string) => Promise<AgentAttempt>;
  now?: () => number;
}

export async function evaluateProposal(
  proposalId: string,
  deps: ProposalEvalDeps,
): Promise<{ evidence: ProposalEvidence; report?: unknown } | null> {
  const changes = await deps.loadProposalChanges(proposalId);
  if (changes === null) return null;

  const tasks = await deps.listHoldout();
  const wt = await deps.prepareWorktrees(tasks[0]);

  try {
    const candidateRules = deps.candidateRulesFor(changes);
    const { replay, report } = await runAgentDifferential({
      tasks,
      baselineCwd: wt.baselineCwd,
      candidateCwd: wt.candidateCwd,
      baselineRules: deps.baselineRules,
      candidateRules,
      runAttempt: deps.runAttempt,
      now: deps.now,
    });
    const evidence = evidenceFromAgentDifferential(replay);
    await attachEvidence(deps.store, proposalId, evidence);
    return { evidence, report };
  } finally {
    await wt.cleanup().catch((error: unknown) => {
      console.warn("提案评估工作树清理失败", { proposalId, error });
    });
  }
}
