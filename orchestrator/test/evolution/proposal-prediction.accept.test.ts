import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { describePrediction, parsePrediction, PREDICTION_METRICS } from "../../src/evolution/prediction.js";
import { runPatrol } from "../../src/loop/patrol.js";
import type { Proposal } from "../../src/loop/self-evolution.js";
import { AgentResearcher } from "../../src/research/researcher.js";
import { synthesizeProposals } from "../../src/research/synthesize.js";

const GOOD = { metric: "verifiedRate", direction: "up", minDelta: 0.05, windowDays: 14 };

class FakeRunner implements AgentRunner {
  lastInput = "";
  constructor(private readonly text: string) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    this.lastInput = req.input;
    return { text: this.text, meta: {}, backend: "claude" };
  }
}

describe("预测结构（作者锁定）", () => {
  test("合格预测原样通过；指标/方向/幅度/窗口任一不合格 → undefined", () => {
    expect(parsePrediction(GOOD)).toEqual(GOOD);
    expect(parsePrediction({ ...GOOD, metric: "happiness" })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, direction: "sideways" })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, minDelta: 0 })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, minDelta: Number.NaN })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, windowDays: 0 })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, windowDays: 61 })).toBeUndefined();
    expect(parsePrediction({ ...GOOD, windowDays: 1.5 })).toBeUndefined();
    expect(parsePrediction(null)).toBeUndefined();
    expect(PREDICTION_METRICS).toEqual(["verifiedRate", "rollbackTokenShare", "tokensPerVerified"]);
  });

  test("人话描述带指标中文名、方向、幅度、窗口", () => {
    const text = describePrediction({ metric: "rollbackTokenShare", direction: "down", minDelta: 0.1, windowDays: 21 });
    expect(text).toContain("回滚流 token 占比");
    expect(text).toContain("下降");
    expect(text).toContain("0.1");
    expect(text).toContain("21 天");
  });
});

describe("调研 → 提案一路带上预测（作者锁定）", () => {
  test("调研提示词要求改动建议附 prediction，并列出三个指标", async () => {
    const runner = new FakeRunner("[]");
    await new AgentResearcher(runner).research("CI 提速");
    expect(runner.lastInput).toContain("prediction");
    for (const metric of PREDICTION_METRICS) expect(runner.lastInput).toContain(metric);
  });

  test("调研结果里合格的 prediction 保留，不合格的丢掉字段但保留发现", async () => {
    const findings = [
      { topic: "t", source: "https://a.example/x", summary: "s1", suggestedConvention: "c1", prediction: GOOD },
      { topic: "t", source: "https://a.example/y", summary: "s2", suggestedConvention: "c2", prediction: { metric: "vibes" } },
    ];
    const out = await new AgentResearcher(new FakeRunner(JSON.stringify(findings))).research("t");
    expect(out).toHaveLength(2);
    expect(out[0]!.prediction).toEqual(GOOD);
    expect(out[1]).not.toHaveProperty("prediction");
    expect(out[1]!.suggestedConvention).toBe("c2");
  });

  test("合成提案时预测跟着每条改动走", () => {
    const changes = synthesizeProposals([
      { topic: "t", source: "https://a.example/x", summary: "s", suggestedConvention: "c", suggestedUpgrade: "u", prediction: parsePrediction(GOOD) },
    ]);
    expect(changes).toHaveLength(2);
    for (const change of changes) expect(change.prediction).toEqual(GOOD);
  });

  test("patrol 落盘的提案：meta 里有预测，正文逐条写出预测或「无预测」告警", async () => {
    const store = new ArtifactStore(join(mkdtempSync(join(tmpdir(), "kp-pred-")), "artifacts"));
    const researcher = {
      async research(topic: string) {
        return [
          { topic, source: "https://a.example/with", summary: "s", suggestedConvention: "有预测的约定", prediction: parsePrediction(GOOD) },
          { topic, source: "https://a.example/without", summary: "s", suggestedConvention: "没预测的约定" },
        ];
      },
    };
    const result = await runPatrol({ store, researcher, researchTopics: ["ci"], now: () => 42 });
    expect(result.proposalId).toBeDefined();
    const artifact = await store.read(result.proposalId!);
    const proposal = artifact.meta.proposal as Proposal;
    const withPred = proposal.changes.find((c) => c.text.includes("有预测的约定"));
    const withoutPred = proposal.changes.find((c) => c.text.includes("没预测的约定"));
    expect(withPred?.prediction).toEqual(GOOD);
    expect(withoutPred?.prediction).toBeUndefined();
    expect(artifact.body).toContain("预测：真实流通过率 上升 ≥ 0.05（观察 14 天）");
    expect(artifact.body).toContain("⚠ 无预测");
  });
});