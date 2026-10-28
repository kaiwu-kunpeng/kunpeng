// 巡检编排器 · 一次巡检循环（C8 确定性、依赖全注入）。
// 把内部经验（每轮）与外部研究（按需）蒸馏为一条待审进化提案草稿，
// 对已有待审提案去重，全程止于人工门 #2——只写 draft，绝不 transition/apply（C5#2、C6）。
import type { ArtifactStore } from "../artifacts/store.js";
import type { Artifact } from "../artifacts/types.js";
import { validateFindings } from "../research/validate.js";
import { synthesizeProposals } from "../research/synthesize.js";
import { buildProposal, persistProposal, type ProposalEvidence, type ProposedChange } from "./self-evolution.js";
import { collectPendingKeys, dedupeChanges } from "./patrol-dedup.js";
import type { Researcher } from "../research/types.js";
import type { FlowTracker } from "../runtime/flowstate.js";
import { reconcileStaleArtifacts } from "../runtime/reconcile.js";
import { epochForTime, tasksFromVerifiedSpecs, type RegressionStore, type RegressionTask } from "../evolution/regression-store.js";
import { evaluateHoldoutReliability, type EvalDeps } from "../evolution/eval-runner.js";
import { attachEvalOutcome, attachEvidence } from "../evolution/eval-deps.js";
import { classifyEvalOutcome } from "../evolution/eval-outcome.js";
import { buildDifferentialEvalDeps } from "../evolution/diff-eval-deps.js";
import { runEvalCurve } from "../evolution/eval-curve.js";
import { checkAdoptedPredictions } from "../evolution/prediction-check.js";

export interface PatrolCurveDeps {
  listHoldout: () => Promise<RegressionTask[]>;
  runAcceptance: (cmd: string, cwd: string) => Promise<{ passed: boolean; ms: number }>;
  baselineCwd?: string;
  prepareCandidate: (
    changes: ProposedChange[],
  ) => Promise<{ candidateCwd: string; baselineCwd?: string; cleanup: () => Promise<void> }>;
}

export interface PatrolDeps {
  store: ArtifactStore;
  tracker?: FlowTracker;
  regressionStore?: RegressionStore;
  evalDeps?: EvalDeps;
  curveDeps?: PatrolCurveDeps;
  researcher?: Researcher;
  researchTopics?: string[];
  /** 跨项目经验：其它已注册项目 .kunpeng/artifacts 里的 experience，并入本仓经验一起蒸馏（让别项目踩的坑也进共享宪法）。 */
  extraExperiences?: Artifact[];
  now?: () => number;
}

export interface PatrolResult {
  staleCleared: number;
  sedimented: number;
  freshChanges: number;
  duplicateChanges: number;
  rejected: number;
  researched: boolean;
  proposalId?: string;
  evidenceAttached?: boolean;
  /** 带候选规则但无验真证据、被 buildProposal 跳过的经验数。 */
  skippedExperiences: number;
  /** 本轮复核了预测的已采纳提案（仅在注入 tracker 时核对）。 */
  predictionsChecked?: string[];
  /** 预测未兑现而新写的回滚提案草稿 id。 */
  revertProposals?: string[];
}

export function patrolUpstream(result: Pick<PatrolResult, "freshChanges" | "skippedExperiences">): number {
  return result.freshChanges + result.skippedExperiences;
}

export async function runPatrol(deps: PatrolDeps): Promise<PatrolResult> {
  const { store, tracker, regressionStore, evalDeps, curveDeps, researcher, researchTopics, extraExperiences, now } = deps;

  const staleCleared = tracker ? (await reconcileStaleArtifacts(tracker)).cleared.length : 0;

  // A0 · 已采纳提案的预测复核：满窗口用流数据比对，未兑现写回滚提案草稿（只提案，C6）。
  const predictionCheck = tracker
    ? await checkAdoptedPredictions({ store, flows: await tracker.list(), ...(now ? { now } : {}) })
    : undefined;

  let sedimented = 0;
  if (regressionStore) {
    const wantEpoch = epochForTime((now ?? Date.now)());
    if (wantEpoch !== await regressionStore.currentEpoch()) {
      await regressionStore.rotate(wantEpoch);
    }
    const specs = await store.list("spec");
    const tasks = tasksFromVerifiedSpecs(specs, (now ?? Date.now)());
    for (const task of tasks) {
      if (await regressionStore.sediment(task)) sedimented += 1;
    }
  }

  // A1 · 内部经验：并入跨项目经验作为 buildProposal 证据来源，不再机械蒸馏产 conventions change。
  const experiences = [...await store.list("experience"), ...(extraExperiences ?? [])];

  // A2 · 外部轨：仅当 researcher 且 researchTopics 同时成立才研究。
  const research: ProposedChange[] = [];
  let researched = false;
  if (researcher && researchTopics?.length) {
    researched = true;
    for (const topic of researchTopics) {
      const findings = await researcher.research(topic);
      const { valid } = validateFindings(findings);
      research.push(...synthesizeProposals(valid));
    }
  }

  // A3 · 构建提案；命中 core 的改动由 buildProposal 自动进 rejected（复用 C6 护栏）。
  const proposal = buildProposal(experiences, research);

  // A4 · 对所有历史提案去重，避免已批准/验证的确定性 change 被反复重提。
  const proposals = await store.list("proposal");
  const keys = collectPendingKeys(proposals);
  const { fresh, duplicate } = dedupeChanges(proposal.changes, keys);

  // A5 · 仅当有新鲜 change 才落盘（status 恒 draft，不越人工门 #2）。
  let proposalId: string | undefined;
  let evidenceAttached = false;
  if (fresh.length > 0) {
    const id = `patrol-${(now ?? Date.now)().toString(36)}`;
    await persistProposal(store, id, { ...proposal, changes: fresh });
    proposalId = id;
    if (curveDeps) {
      let cleanup: (() => Promise<void>) | undefined;
      try {
        const prep = await curveDeps.prepareCandidate(fresh);
        cleanup = prep.cleanup;
        const baselineCwd = prep.baselineCwd ?? curveDeps.baselineCwd;
        if (baselineCwd === undefined) throw new Error("巡检曲线缺少基线工作树");
        const diffDeps = buildDifferentialEvalDeps({
          listHoldout: curveDeps.listHoldout,
          runAcceptance: curveDeps.runAcceptance,
          baselineCwd,
          candidateCwd: prep.candidateCwd,
        });
        const measuredAt = (now ?? Date.now)();
        const { replay } = await runEvalCurve(diffDeps);
        const evidence: ProposalEvidence = {
          holdoutPassK: replay.candidatePassK,
          costPerResolvedTask: replay.costPerResolvedTask,
          baseline: {
            holdoutPassK: replay.baselinePassK,
          },
          measuredAt,
        };
        await attachEvidence(store, id, evidence);
        await attachEvalOutcome(store, id, classifyEvalOutcome({ ok: true }));
        evidenceAttached = true;
      } catch (error) {
        await attachEvalOutcome(store, id, classifyEvalOutcome({ ok: false, error })).catch(() => {});
        // 差分评测失败不阻断巡检：提案保持无证据 draft，证据闸 fail-closed。
      } finally {
        if (cleanup) {
          try {
            await cleanup();
          } catch {
            // 清理失败也不得让巡检抛错；候选 worktree 生命周期由注入方负责。
          }
        }
      }
    } else if (evalDeps) {
      try {
        const evidence = await evaluateHoldoutReliability(evalDeps);
        await attachEvidence(store, id, evidence);
        await attachEvalOutcome(store, id, classifyEvalOutcome({ ok: true }));
        evidenceAttached = true;
      } catch (error) {
        await attachEvalOutcome(store, id, classifyEvalOutcome({ ok: false, error })).catch(() => {});
        // 评测失败不阻断巡检：提案保持无证据 draft，证据闸自然 fail-closed。
      }
    }
  }

  // A6 · 返回本轮巡检结果。
  return {
    staleCleared,
    sedimented,
    freshChanges: fresh.length,
    duplicateChanges: duplicate.length,
    rejected: proposal.rejected.length,
    researched,
    proposalId,
    evidenceAttached,
    skippedExperiences: proposal.skipped?.length ?? 0,
    ...(predictionCheck ? { predictionsChecked: predictionCheck.checked, revertProposals: predictionCheck.revertProposals } : {}),
  };
}
