import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_RATE,
  DEFAULT_PRICE_PER_MTOK,
  MODEL_PRICING_PER_MTOK,
  MODEL_RATE_CARD,
  estimateCostUsd,
  estimateUsageCostUsd,
  rateCardForModel,
} from "../../src/runtime/cost-pricing.js";
import { formatChatUsageLine, sumConversationUsd } from "../../src/server/chat-usage.js";

const M = 1_000_000;

describe("四向价目表(作者锁定,2026-09-04 官方价目快照)", () => {
  it("每个下拉模型命中正确条目与单价", () => {
    const expectRate = (model: string, input: number, cacheWrite: number, cacheRead: number, output: number) => {
      const r = rateCardForModel(model);
      expect([r.input, r.cacheWrite, r.cacheRead, r.output], model).toEqual([input, cacheWrite, cacheRead, output]);
    };
    expectRate("claude-fable-5-1", 10, 12.5, 0.25, 50);
    expectRate("claude-fable-5", 10, 12.5, 1, 50);
    expectRate("claude-opus-5", 5, 6.25, 0.5, 25);
    expectRate("claude-opus-5[1m]", 5, 6.25, 0.5, 25);
    expectRate("claude-opus-4-8", 5, 6.25, 0.5, 25);
    expectRate("claude-sonnet-5", 2, 2.5, 0.2, 10);
    expectRate("claude-sonnet-4-6", 3, 3.75, 0.3, 15);
    expectRate("claude-haiku-4-5", 1, 1.25, 0.1, 5);
    expectRate("gpt-6-astra", 10, 12.5, 1, 50);
    expectRate("gpt-5.5", 5, 6.25, 0.5, 30);
    expectRate("codex", 5, 6.25, 0.5, 30);
    expectRate("gpt-5.6-sol", 4, 5, 0.4, 20);
    expectRate("gpt-5.6-terra", 2, 2.5, 0.2, 12);
    expectRate("gpt-5.6-luna", 0.2, 0.25, 0.02, 1.2);
    expectRate("gpt-5.6-sol@xhigh", 4, 5, 0.4, 20);
    expect(rateCardForModel("weird-model")).toBe(DEFAULT_MODEL_RATE);
    expect(rateCardForModel("")).toBe(DEFAULT_MODEL_RATE);
  });

  it("混合价表由价目表推导且形状不变(前端 KP_PRICING 依赖 {match, usd}[])", () => {
    expect(MODEL_PRICING_PER_MTOK.map((p) => p.match)).toEqual(MODEL_RATE_CARD.map((r) => r.match));
    for (const [i, p] of MODEL_PRICING_PER_MTOK.entries()) {
      const r = MODEL_RATE_CARD[i]!;
      expect(p.usd).toBe((r.input + r.output) / 2);
      expect(Object.keys(p).sort()).toEqual(["match", "usd"]);
    }
    expect(DEFAULT_PRICE_PER_MTOK).toBe(3);
    expect(estimateCostUsd({ "gpt-6-astra": M }).totalUsd).toBe(30);
    expect(estimateCostUsd({ "gpt-5.5": M }).totalUsd).toBe(17.5);
    expect(estimateCostUsd({ "claude-sonnet-5": M }).totalUsd).toBe(6);
  });

  it("estimateUsageCostUsd 四向精确计价", () => {
    // opus: 100k in ×5 + 10k out ×25 + 50k cache 写 ×6.25 + 800k cache 读 ×0.5
    expect(estimateUsageCostUsd({ input: 100_000, output: 10_000, cacheCreate: 50_000, cacheRead: 800_000 }, "claude-opus-5"))
      .toBeCloseTo(0.5 + 0.25 + 0.3125 + 0.4, 9);
    // fable 5.1 cache 读特价 0.25
    expect(estimateUsageCostUsd({ cacheRead: M }, "claude-fable-5-1")).toBeCloseTo(0.25, 9);
    expect(estimateUsageCostUsd({ cacheRead: M }, "claude-fable-5")).toBeCloseTo(1, 9);
    // astra: 1M in + 100k out
    expect(estimateUsageCostUsd({ input: M, output: 100_000 }, "gpt-6-astra")).toBeCloseTo(10 + 5, 9);
    // 缺失/负数/NaN 按 0;未知模型走兜底价
    expect(estimateUsageCostUsd({}, "claude-opus-5")).toBe(0);
    expect(estimateUsageCostUsd({ input: -5, output: Number.NaN }, "codex")).toBe(0);
    expect(estimateUsageCostUsd({ input: M, output: M }, "weird-model")).toBeCloseTo(1 + 5, 9);
  });

  it("chat usage 行与会话累计走四向价(不再是混合价 × 计费 token)", () => {
    // 缓存重的一轮:opus in 2 / out 4 / cache 写 14242 / cache 读 10005
    const usage = { input: 2, output: 4, cacheCreate: 14242, cacheRead: 10005, model: "claude-opus-5" };
    const exact = (2 * 5 + 4 * 25 + 14242 * 6.25 + 10005 * 0.5) / M;
    expect(formatChatUsageLine(usage)).toContain(`$${exact.toFixed(4)}`);
    expect(sumConversationUsd([{ usage }, { usage }])).toBeCloseTo(exact * 2, 9);
    // 同样 token 若按旧口径(计费 token × 混合价 15)会高出数倍,锁死不回退
    const legacy = ((2 + 4 + Math.round(14242 * 1.25 + 10005 * 0.1)) / M) * 15;
    expect(exact).toBeLessThan(legacy / 2);
  });
});