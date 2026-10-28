import { describe, expect, it } from "vitest";
import { aggregateTokensByModel, aggregateChatTokensByModel } from "../src/server/state.js";
import { estimateCostUsd } from "../src/runtime/cost-pricing.js";

describe("真实模型统计聚合(作者验收)", () => {
  it("聚合优先用落盘的真实模型标签", () => {
    const out = aggregateTokensByModel([
      { backend: "codex", stageModels: { implement: "gpt-5.6-sol@xhigh" }, stageTokens: { implement: 100 } },
    ] as never);
    expect(out["gpt-5.6-sol@xhigh"]).toBe(100);
  });

  it("无 stageModels 的旧流回退 tier 推断(兼容不破)", () => {
    const out = aggregateTokensByModel([
      { backend: "claude", stageTokens: { implement: 50 } },
    ] as never);
    // 旧流无 stageModels 时按当前 CLAUDE_TIER 推断(2026-09-07 起为 opus-5)
    expect(out["claude-opus-5"]).toBe(50);
  });

  it("定价表覆盖 fable 与 5.6 三档,且 5.6 条目先于泛化 gpt/high 匹配", () => {
    const cost = estimateCostUsd({
      "claude-fable-5": 1_000_000,
      "gpt-5.6-sol@xhigh": 1_000_000,
      "gpt-5.6-terra@medium": 1_000_000,
      "gpt-5.6-luna@low": 1_000_000,
    });
    expect(cost.byModel["claude-fable-5"]).toBe(30);
    // 2026-09-04 官方价目:sol 4/20、terra 2/12、luna 0.2/1.2 → 混合 12 / 7 / 0.7
    expect(cost.byModel["gpt-5.6-sol@xhigh"]).toBe(12);
    expect(cost.byModel["gpt-5.6-terra@medium"]).toBe(7);
    expect(cost.byModel["gpt-5.6-luna@low"]).toBe(0.7);
  });

  it("chat 会话用量按真实模型聚合,无 model 归 chat-unknown", () => {
    const out = aggregateChatTokensByModel([
      { turns: [{ usage: { input: 10, output: 20, model: "claude-fable-5" } }, { usage: { input: 1, output: 2 } }] },
    ]);
    expect(out["claude-fable-5"]).toBe(30);
    expect(out["chat-unknown"]).toBe(3);
  });
});