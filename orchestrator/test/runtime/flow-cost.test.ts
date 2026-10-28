import { describe, it, expect } from "vitest";
import { flowsToCostReport } from "../../src/runtime/flow-cost.js";

describe("flowsToCostReport：从 flow 按阶段 token 推真实成本", () => {
  it("按 stageTokens + stageBackends 汇总 token 与 USD", () => {
    const r = flowsToCostReport([
      { stageTokens: { spec: 100, implement: 200 }, stageBackends: { spec: "opus", implement: "codex" } },
      { stageTokens: { review: 50 }, stageBackends: { review: "opus" } },
    ]);
    expect(r.totalTokens).toBe(350); // 100+200+50
    expect(r.tokensByModel.opus).toBe(150); // spec 100 + review 50
    expect(r.tokensByModel.codex).toBe(200);
    expect(r.cost.totalUsd).toBeGreaterThan(0); // 真实定价，非 0
  });

  it("无 stageTokens 但有 tokensUsed → 兜底归 unknown", () => {
    const r = flowsToCostReport([{ tokensUsed: 500 }]);
    expect(r.totalTokens).toBe(500);
  });

  it("跳过 0/负 token，空输入 → 0", () => {
    expect(flowsToCostReport([{ stageTokens: { spec: 0, implement: -5 } }]).totalTokens).toBe(0);
    expect(flowsToCostReport([]).totalTokens).toBe(0);
  });
});
