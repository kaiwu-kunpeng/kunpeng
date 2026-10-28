import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import {
  checkAdoptedPredictions,
  computeMetric,
  DAY_MS,
  judgePrediction,
  MIN_PREDICTION_SAMPLE,
  type FlowSample,
} from "../../src/evolution/prediction-check.js";
import type { Prediction } from "../../src/evolution/prediction.js";
import { runPatrol } from "../../src/loop/patrol.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const ADOPTED = 100 * DAY_MS;
const UP5: Prediction = { metric: "verifiedRate", direction: "up", minDelta: 0.2, windowDays: 10 };

/** 在 [start, start+10 天) 里均匀放 n 条流，前 ok 条 verified、其余 rolled-back，每条 1000 token。 */
function window(start: number, n: number, ok: number, prefix: string): FlowSample[] {
  return Array.from({ length: n }, (_, i) => ({
    flowId: `${prefix}-${i}`,
    status: i < ok ? "verified" : "rolled-back",
    startedAt: start + i * DAY_MS,
    tokensUsed: 1000,
  }));
}

describe("指标计算（作者锁定）", () => {
  test("只算已终结的真实流，剔除 plan 壳流与窗口外的流", () => {
    const flows: FlowSample[] = [
      { flowId: "a", status: "verified", startedAt: 10, tokensUsed: 300 },
      { flowId: "b", status: "rolled-back", startedAt: 20, tokensUsed: 100 },
      { flowId: "plan-x", status: "verified", startedAt: 30, tokensUsed: 999 },
      { flowId: "c", status: "running", startedAt: 40, tokensUsed: 999 },
      { flowId: "d", status: "verified", startedAt: 500, tokensUsed: 999 },
    ];
    expect(computeMetric("verifiedRate", flows, 0, 100)).toEqual({ value: 0.5, sample: 2 });
    expect(computeMetric("rollbackTokenShare", flows, 0, 100)).toEqual({ value: 0.25, sample: 2 });
    expect(computeMetric("tokensPerVerified", flows, 0, 100)).toEqual({ value: 400, sample: 2 });
    expect(computeMetric("verifiedRate", flows, 1000, 2000)).toEqual({ value: undefined, sample: 0 });
  });
});

describe("预测判定（作者锁定）", () => {
  const before = window(ADOPTED - 10 * DAY_MS, 10, 5, "b");
  test("满窗口且提升够 → met；提升不够 → missed", () => {
    const met = judgePrediction(UP5, ADOPTED, ADOPTED + 11 * DAY_MS, [...before, ...window(ADOPTED, 10, 8, "a")]);
    expect(met.verdict).toBe("met");
    expect(met.before).toBeCloseTo(0.5);
    expect(met.after).toBeCloseTo(0.8);
    const missed = judgePrediction(UP5, ADOPTED, ADOPTED + 11 * DAY_MS, [...before, ...window(ADOPTED, 10, 6, "a")]);
    expect(missed.verdict).toBe("missed");
    expect(missed.delta).toBeCloseTo(0.1);
  });

  test("direction=down：指标下降够才算 met", () => {
    const down: Prediction = { metric: "rollbackTokenShare", direction: "down", minDelta: 0.2, windowDays: 10 };
    expect(judgePrediction(down, ADOPTED, ADOPTED + 11 * DAY_MS, [...before, ...window(ADOPTED, 10, 8, "a")]).verdict).toBe("met");
    expect(judgePrediction(down, ADOPTED, ADOPTED + 11 * DAY_MS, [...before, ...window(ADOPTED, 10, 4, "a")]).verdict).toBe("missed");
  });

  test("窗口未满 → pending；任一侧样本少于下限 → insufficient", () => {
    expect(judgePrediction(UP5, ADOPTED, ADOPTED + 5 * DAY_MS, before).verdict).toBe("pending");
    const thin = judgePrediction(UP5, ADOPTED, ADOPTED + 11 * DAY_MS, [...before, ...window(ADOPTED, MIN_PREDICTION_SAMPLE - 1, 4, "a")]);
    expect(thin.verdict).toBe("insufficient");
    expect(MIN_PREDICTION_SAMPLE).toBe(5);
  });
});

async function adoptedProposal(store: ArtifactStore, id: string, prediction: Prediction | undefined, status: "approved" | "draft" = "approved"): Promise<void> {
  await store.write({
    kind: "proposal",
    id,
    status,
    body: "# 提案",
    meta: {
      proposal: { sourceExperiences: [], rejected: [], changes: [{ target: "conventions", text: `${id} 的约定`, source: "research:x", ...(prediction ? { prediction } : {}) }] },
      ...(status === "approved" ? { decidedBy: { by: "human", via: "cockpit", at: ADOPTED, decision: "approved" } } : {}),
    },
  });
}

describe("核对已采纳提案并写回滚草稿（作者锁定）", () => {
  test("missed → 结论写回 meta，并写 revert-<id> 草稿；met 不写；草稿与未带预测的不核对；不重复写", async () => {
    const store = new ArtifactStore(join(mkdtempSync(join(tmpdir(), "kp-pcheck-")), "artifacts"));
    await adoptedProposal(store, "p-miss", UP5);
    await adoptedProposal(store, "p-met", { ...UP5, minDelta: 0.05 });
    await adoptedProposal(store, "p-draft", UP5, "draft");
    await adoptedProposal(store, "p-nopred", undefined);
    const flows = [...window(ADOPTED - 10 * DAY_MS, 10, 5, "b"), ...window(ADOPTED, 10, 6, "a")];

    const first = await checkAdoptedPredictions({ store, flows, now: () => ADOPTED + 11 * DAY_MS });
    expect(first.checked.sort()).toEqual(["p-met", "p-miss"]);
    expect(first.revertProposals).toEqual(["revert-p-miss"]);
    const outcomes = (await store.read("p-miss")).meta.predictionOutcomes as Array<{ verdict: string; change: number }>;
    expect(outcomes).toEqual([expect.objectContaining({ verdict: "missed", change: 0 })]);
    const revert = await store.read("revert-p-miss");
    expect(revert.kind).toBe("proposal");
    expect(revert.status).toBe("draft");
    expect(revert.meta.revertOf).toBe("p-miss");
    expect(revert.body).toContain("p-miss 的约定");
    expect(revert.body).toContain("人工门 #2");

    const second = await checkAdoptedPredictions({ store, flows, now: () => ADOPTED + 12 * DAY_MS });
    expect(second.revertProposals).toEqual([]);
  });

  test("patrol 注入 tracker 时顺带核对：真 FlowTracker 的流数据驱动回滚草稿", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-pcheck-patrol-"));
    const store = new ArtifactStore(join(root, "artifacts"));
    await adoptedProposal(store, "p-live", UP5);
    let clock = 0;
    const tracker = new FlowTracker(join(root, "state"), () => clock);
    for (const flow of [...window(ADOPTED - 10 * DAY_MS, 10, 5, "b"), ...window(ADOPTED, 10, 5, "a")]) {
      clock = flow.startedAt;
      await tracker.start(flow.flowId, "需求");
      await tracker.addTokens(flow.flowId, flow.tokensUsed ?? 0);
      await tracker.finish(flow.flowId, flow.status as "verified" | "rolled-back");
    }
    clock = ADOPTED + 11 * DAY_MS;
    const result = await runPatrol({ store, tracker, now: () => clock });
    expect(result.predictionsChecked).toEqual(["p-live"]);
    expect(result.revertProposals).toEqual(["revert-p-live"]);
    expect((await store.read("revert-p-live")).status).toBe("draft");
  });
});