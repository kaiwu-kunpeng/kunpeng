/** 提案预测核对器（AHE「决策可观测」第二步）：采纳满窗口后，用流数据确定性复核每条改动的预测；
 *  没达到就写一条回滚提案草稿（只提案、不应用，仍走人工门 #2，C6）。不调 LLM（C8）。 */
import type { ArtifactStore } from "../artifacts/store.js";
import type { ProposedChange } from "../loop/self-evolution.js";
import { describePrediction, parsePrediction, type Prediction, type PredictionMetric } from "./prediction.js";

export const DAY_MS = 86_400_000;
/** 窗口任一侧真实流少于这个数就不下结论（小样本不判）。 */
export const MIN_PREDICTION_SAMPLE = 5;

export interface FlowSample {
  flowId: string;
  status: string;
  startedAt: number;
  tokensUsed?: number;
}

export type PredictionVerdict = "met" | "missed" | "pending" | "insufficient";

export interface PredictionOutcome {
  verdict: PredictionVerdict;
  before?: number;
  after?: number;
  delta?: number;
  reason: string;
}

/** [fromMs, toMs) 内已终结的真实流（剔除 plan 壳流）上的指标值；分母为 0 时 value 为 undefined。 */
export function computeMetric(
  metric: PredictionMetric,
  flows: readonly FlowSample[],
  fromMs: number,
  toMs: number,
): { value: number | undefined; sample: number } {
  const real = flows.filter((flow) =>
    !flow.flowId.startsWith("plan-")
    && flow.startedAt >= fromMs && flow.startedAt < toMs
    && (flow.status === "verified" || flow.status === "rolled-back"));
  const verified = real.filter((flow) => flow.status === "verified");
  const tokens = (list: readonly FlowSample[]): number => list.reduce((sum, flow) => sum + (flow.tokensUsed ?? 0), 0);
  const sample = real.length;
  if (metric === "verifiedRate") return { value: sample > 0 ? verified.length / sample : undefined, sample };
  const all = tokens(real);
  if (metric === "rollbackTokenShare") {
    return { value: all > 0 ? tokens(real.filter((flow) => flow.status === "rolled-back")) / all : undefined, sample };
  }
  return { value: verified.length > 0 ? all / verified.length : undefined, sample };
}

/** 采纳前一个窗口 vs 采纳后一个窗口；未满窗口 pending，样本不足 insufficient。 */
export function judgePrediction(
  prediction: Prediction,
  adoptedAt: number,
  now: number,
  flows: readonly FlowSample[],
): PredictionOutcome {
  const windowMs = prediction.windowDays * DAY_MS;
  if (now < adoptedAt + windowMs) {
    return { verdict: "pending", reason: `观察窗未满（${prediction.windowDays} 天）` };
  }
  const before = computeMetric(prediction.metric, flows, adoptedAt - windowMs, adoptedAt);
  const after = computeMetric(prediction.metric, flows, adoptedAt, adoptedAt + windowMs);
  if (before.sample < MIN_PREDICTION_SAMPLE || after.sample < MIN_PREDICTION_SAMPLE
    || before.value === undefined || after.value === undefined) {
    return {
      verdict: "insufficient",
      reason: `样本不足（采纳前 ${before.sample} 条、采纳后 ${after.sample} 条，每侧至少 ${MIN_PREDICTION_SAMPLE} 条）`,
    };
  }
  const delta = after.value - before.value;
  const signed = prediction.direction === "up" ? delta : -delta;
  const verdict: PredictionVerdict = signed >= prediction.minDelta ? "met" : "missed";
  return {
    verdict,
    before: before.value,
    after: after.value,
    delta,
    reason: `${describePrediction(prediction)}：采纳前 ${before.value.toFixed(4)} → 采纳后 ${after.value.toFixed(4)}`,
  };
}

export interface PredictionCheckResult {
  checked: string[];
  revertProposals: string[];
}

function adoptedAtOf(meta: Record<string, unknown>): number | undefined {
  const decided = meta.decidedBy;
  if (typeof decided !== "object" || decided === null) return undefined;
  const record = decided as Record<string, unknown>;
  return record.decision === "approved" && typeof record.at === "number" && Number.isFinite(record.at) ? record.at : undefined;
}

/** 扫已采纳（approved / in-progress / verified）且带预测的提案，把各条改动的核对结论写回 meta.predictionOutcomes；
 *  任一条 missed → 写 revert-<id> 草稿（已存在则不重复写）。 */
export async function checkAdoptedPredictions(deps: {
  store: ArtifactStore;
  flows: readonly FlowSample[];
  now?: () => number;
}): Promise<PredictionCheckResult> {
  const now = (deps.now ?? Date.now)();
  const proposals = await deps.store.list("proposal");
  const existing = new Set(proposals.map((proposal) => proposal.id));
  const result: PredictionCheckResult = { checked: [], revertProposals: [] };
  for (const artifact of proposals) {
    if (artifact.status !== "approved" && artifact.status !== "in-progress" && artifact.status !== "verified") continue;
    const adoptedAt = adoptedAtOf(artifact.meta);
    if (adoptedAt === undefined) continue;
    const proposal = artifact.meta.proposal as { changes?: ProposedChange[] } | undefined;
    const changes = Array.isArray(proposal?.changes) ? proposal.changes : [];
    const outcomes: Array<PredictionOutcome & { change: number }> = [];
    changes.forEach((change, index) => {
      const prediction = parsePrediction(change.prediction);
      if (prediction) outcomes.push({ change: index, ...judgePrediction(prediction, adoptedAt, now, deps.flows) });
    });
    if (outcomes.length === 0) continue;
    await deps.store.patchMeta(artifact.id, { predictionOutcomes: outcomes, predictionCheckedAt: now });
    result.checked.push(artifact.id);
    const missed = outcomes.filter((outcome) => outcome.verdict === "missed");
    const revertId = `revert-${artifact.id}`;
    if (missed.length === 0 || existing.has(revertId)) continue;
    const lines = [
      `# 回滚提案：${artifact.id} 的预测未兑现（需人工批准 — 人工门 #2）`,
      "",
      ...missed.map((outcome) => `- 改动：${changes[outcome.change]?.text ?? "(未知)"}\n  - ${outcome.reason}`),
    ];
    await deps.store.write({
      kind: "proposal",
      id: revertId,
      status: "draft",
      body: lines.join("\n"),
      meta: { revertOf: artifact.id, missed },
    });
    existing.add(revertId);
    result.revertProposals.push(revertId);
  }
  return result;
}
