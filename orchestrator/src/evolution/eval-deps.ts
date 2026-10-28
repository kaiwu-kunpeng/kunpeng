import { join } from "node:path";
import type { ArtifactStore } from "../artifacts/store.js";
import type { ProposalEvidence } from "../loop/self-evolution.js";
import { runVerification } from "../verify/gate.js";
import type { EvalOutcome } from "./eval-outcome.js";
import { type EvalDeps } from "./eval-runner.js";
import { RegressionStore } from "./regression-store.js";

export async function attachEvidence(
  store: ArtifactStore,
  proposalId: string,
  evidence: ProposalEvidence,
): Promise<void> {
  const artifact = await store.read(proposalId);
  const meta = artifact.meta as { proposal?: Record<string, unknown> } & Record<string, unknown>;
  meta.proposal = { ...(meta.proposal || {}), evidence };
  await store.write({ ...artifact, meta });
}

export async function attachEvalOutcome(
  store: ArtifactStore,
  proposalId: string,
  outcome: EvalOutcome,
): Promise<void> {
  const artifact = await store.read(proposalId);
  const meta = artifact.meta as { proposal?: Record<string, unknown> } & Record<string, unknown>;
  meta.proposal = {
    ...(meta.proposal || {}),
    evidenceState: outcome.evidenceState,
    ...(outcome.reason !== undefined ? { evidenceReason: outcome.reason } : {}),
  };
  await store.write({ ...artifact, meta });
}

export function buildEvalDeps(repoRoot: string): EvalDeps {
  return {
    listHoldout: () => new RegressionStore(join(repoRoot, ".kunpeng", "regression")).list("holdout"),
    runAcceptance: async (cmd, cwd) => {
      const t0 = Date.now();
      const result = await runVerification({ cwd, cmd });
      return { passed: result.passed, ms: Date.now() - t0 };
    },
    cwd: repoRoot,
    now: Date.now,
  };
}
