import { describe, expect, test } from "vitest";
import { MODEL_PRICING_PER_MTOK, estimateUsageCostUsd, rateCardForModel } from "../../src/runtime/cost-pricing.js";

function rate(model: string): number[] {
  const r = rateCardForModel(model);
  return [r.input, r.cacheWrite, r.cacheRead, r.output];
}

describe("价目表 GPT-6 Sol / Luna（作者锁定）", () => {
  test("新两档按官方价命中", () => {
    expect(rate("gpt-6-sol")).toEqual([2, 2.5, 0.2, 10]);
    expect(rate("gpt-6-luna")).toEqual([0.1, 0.125, 0.01, 0.5]);
    expect(rate("gpt-6-sol@xhigh")).toEqual([2, 2.5, 0.2, 10]);
  });
  test("5.6 系列与 Astra 不被子串误伤", () => {
    expect(rate("gpt-5.6-sol")).toEqual([4, 5, 0.4, 20]);
    expect(rate("gpt-5.6-luna")).toEqual([0.2, 0.25, 0.02, 1.2]);
    expect(rate("gpt-5.6-terra")).toEqual([2, 2.5, 0.2, 12]);
    expect(rate("gpt-6-astra")).toEqual([10, 12.5, 1, 50]);
    expect(rate("gpt-6-unknown")).toEqual([5, 6.25, 0.5, 30]);
  });
  test("混合单价表同步带上，费用估算正确", () => {
    const sol = MODEL_PRICING_PER_MTOK.find(p => p.match === "gpt-6-sol");
    const luna = MODEL_PRICING_PER_MTOK.find(p => p.match === "gpt-6-luna");
    expect(sol?.usd).toBe(6);
    expect(luna?.usd).toBeCloseTo(0.3, 9);
    expect(estimateUsageCostUsd({ input: 1_000_000, output: 100_000 }, "gpt-6-luna")).toBeCloseTo(0.1 + 0.05, 9);
    expect(estimateUsageCostUsd({ input: 1_000_000, output: 100_000 }, "gpt-6-sol")).toBeCloseTo(2 + 1, 9);
  });
});