import { join } from "node:path";
import type { ArtifactSummary } from "../../artifacts/store.js";
import { evolutionProposalFromArtifact } from "../../evolution/apply.js";
import { RegressionStore } from "../../evolution/regression-store.js";
import { hasApplicableEvidence } from "../../loop/self-evolution.js";
import { summarizePatrol } from "../patrol-summary.js";
import { summarizeChannels } from "../evolution-channels.js";
import type { EvolutionTruth } from "../state-types.js";

/** 从 patrol-<base36毫秒> 提案 id 还原上次巡检时间（取最新）。无 patrol 提案则 undefined。 */
function lastPatrolAtFrom(arts: ArtifactSummary[]): number | undefined {
  const times = arts
    .filter((a) => a.kind === "proposal" && a.id.startsWith("patrol-"))
    .map((a) => parseInt(a.id.slice("patrol-".length), 36))
    .filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : undefined;
}

async function readRegressionCounts(repoRoot: string): Promise<{ holdout: number; optimization: number; epoch: number }> {
  try {
    const regressionStore = new RegressionStore(join(repoRoot, ".kunpeng", "regression"));
    const [holdout, optimization] = await Promise.all([
      regressionStore.list("holdout"),
      regressionStore.list("optimization"),
    ]);
    let epoch = 0;
    try { epoch = await regressionStore.currentEpoch(); } catch { epoch = 0; }
    return { holdout: holdout.length, optimization: optimization.length, epoch };
  } catch {
    return { holdout: 0, optimization: 0, epoch: 0 };
  }
}

export async function collectEvolutionTruth({ arts, repoRoot }: {
  arts: ArtifactSummary[];
  repoRoot: string;
}) {
  const proposalArts = arts.filter((a) => a.kind === "proposal");
  const patrol = summarizePatrol(proposalArts, lastPatrolAtFrom(arts));
  const regression = await readRegressionCounts(repoRoot);
  const approvedCount = proposalArts.filter((a) => a.status === "approved").length;
  const proposalDetails = proposalArts.map((artifact, index) => {
    const proposal = evolutionProposalFromArtifact(artifact);
    const evidence = proposal.evidence;
    const holdoutPassK = evidence?.holdoutPassK;
    const baselinePassK = evidence?.baseline?.holdoutPassK;
    const delta = holdoutPassK !== undefined || baselinePassK !== undefined
      ? (holdoutPassK ?? 0) - (baselinePassK ?? 0)
      : undefined;
    return { artifact, index, proposal, evidence, holdoutPassK, baselinePassK, delta };
  });
  const series = proposalDetails
    .filter((item): item is typeof item & { holdoutPassK: number; delta: number } =>
      item.holdoutPassK !== undefined && item.delta !== undefined)
    .map((item) => ({ id: item.proposal.id, pass: item.holdoutPassK, delta: item.delta }))
    .slice(-12);
  const latestSeries = series.at(-1);
  const upgrades = proposalDetails
    .filter((item) => item.proposal.status === "verified")
    .slice(-20)
    .reverse()
    .map(({ artifact, proposal, holdoutPassK, delta }) => {
      const summary = artifact.summary;
      return {
        id: proposal.id,
        summary,
        changes: proposal.changes.map((change) => ({ target: change.target, text: change.text })),
        ...(holdoutPassK !== undefined && { holdoutPassK }),
        ...(delta !== undefined && { delta }),
      };
    });
  const evolution: EvolutionTruth = {
    lastRunText: patrol.lastRunText,
    pendingCount: patrol.pendingCount,
    channels: summarizeChannels(proposalDetails.map(({ artifact }) => {
      const pm = (artifact.meta?.proposal ?? {}) as { channel?: string; evidenceState?: string };
      return { channel: pm.channel, evidenceState: pm.evidenceState };
    })),
    proposals: proposalDetails
      .sort((a, b) => {
        const draftDelta = Number(b.artifact.status === "draft") - Number(a.artifact.status === "draft");
        return draftDelta || a.index - b.index;
      })
      .slice(0, 20)
      .map(({ artifact, proposal, evidence, holdoutPassK, baselinePassK, delta }) => {
        const summary = artifact.summary;
        const pm = (artifact.meta?.proposal ?? {}) as { channel?: string; evidenceState?: string; score?: number; sources?: string[] };
        return {
          id: proposal.id,
          status: proposal.status,
          summary,
          hasEvidence: hasApplicableEvidence(evidence),
          ...(pm.channel && { channel: pm.channel }),
          ...(pm.evidenceState && { evidenceState: pm.evidenceState }),
          ...(pm.score !== undefined && { score: pm.score }),
          ...(Array.isArray(pm.sources) && { sources: pm.sources }),
          ...(holdoutPassK !== undefined && { holdoutPassK }),
          ...(baselinePassK !== undefined && { baselinePassK }),
          ...(delta !== undefined && { delta }),
          ...(evidence?.costPerResolvedTask !== undefined && { costPerResolvedTask: evidence.costPerResolvedTask }),
        };
    }),
    regression: { holdout: regression.holdout, optimization: regression.optimization },
    approvedCount,
    upgrades,
    dashboard: {
      ...(latestSeries && { holdoutPassAt1: latestSeries.pass, lastDelta: latestSeries.delta }),
      archiveSize: proposalArts.length,
      approvedCount,
      holdoutCount: regression.holdout,
      optimizationCount: regression.optimization,
      holdoutEpoch: regression.epoch,
      series,
    },
  };

  return { evolution, patrol };
}
