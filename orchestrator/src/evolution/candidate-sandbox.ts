import { join } from "node:path";
import type { ProposedChange } from "../loop/self-evolution.js";

export interface CandidateSandboxConfig {
  acquire: (flowId: string, base?: string) => Promise<{ path: string }>;
  cleanup: (flowId: string) => Promise<void>;
  applyChanges: (
    conventionsPath: string,
    changes: ProposedChange[],
  ) => Promise<{ appended: string[]; skipped: string[] }>;
  conventionsRelPath: string;
  base?: string;
  newFlowId: () => string;
  baselineFlowId?: () => string;
}

export interface PreparedCandidate {
  candidateCwd: string;
  baselineCwd?: string;
  cleanup: () => Promise<void>;
  appliedChanges: string[];
}

export function buildCandidateSandbox(
  config: CandidateSandboxConfig,
): (changes: ProposedChange[]) => Promise<PreparedCandidate> {
  return async (changes: ProposedChange[]) => {
    const flowId = config.newFlowId();
    const baselineFlowId = config.baselineFlowId?.();
    const baseline = baselineFlowId === undefined ? undefined : await config.acquire(baselineFlowId, config.base);
    const cleanup = async () => {
      try {
        await config.cleanup(flowId);
      } finally {
        if (baselineFlowId !== undefined) await config.cleanup(baselineFlowId);
      }
    };
    let candidateAcquired = false;
    try {
      const flow = await config.acquire(flowId, config.base);
      candidateAcquired = true;
      const applied = await config.applyChanges(
        join(flow.path, config.conventionsRelPath),
        changes,
      );
      return {
        candidateCwd: flow.path,
        ...(baseline ? { baselineCwd: baseline.path } : {}),
        appliedChanges: applied.appended,
        cleanup,
      };
    } catch (error) {
      if (baseline || candidateAcquired) await cleanup();
      throw error;
    }
  };
}
