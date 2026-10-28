import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { flowUsdStageMix, flowsUsdStageMix } from "../../src/runtime/flow-cost.js";
import { sumFlowUsd } from "../../src/runtime/run-budget.js";
import { forecastBurnFromFlow } from "../../src/metrics/burn-forecast.js";
import { budgetReviewItem } from "../../src/server/inbox-budget.js";

// 取自 2026-09-15 真实流状态（.kunpeng/state）：spec 跑 claude-opus-5，implement 跑 gpt-6-astra@xhigh。
const REAL = {
  backend: "codex",
  stageBackends: { spec: "claude", implement: "codex" },
  stageModels: { spec: "claude-opus-5", implement: "gpt-6-astra@xhigh" },
  stageTokens: { spec: 16464, implement: 186207 },
  tokensUsed: 202671,
  startedAt: 0,
  updatedAt: 3_600_000,
};
// opus 混合价 (5+25)/2=15，astra (10+50)/2=30 → 16464e-6*15 + 186207e-6*30 = 0.24696 + 5.58621
const REAL_USD = 5.8332;
const LEGACY = { backend: "codex", tokensUsed: 1_000_000, startedAt: 0, updatedAt: 3_600_000 };

describe("阶段混合计价成为唯一口径（作者锁定）", () => {
  it("有阶段明细 → 按各阶段模型价；无明细 → 退回旧的后端键口径", () => {
    expect(flowUsdStageMix(REAL)).toBeCloseTo(REAL_USD, 3);
    expect(flowUsdStageMix(LEGACY)).toBeCloseTo(17.5, 3);
    expect(flowUsdStageMix({})).toBe(0);
    expect(flowsUsdStageMix([REAL, LEGACY])).toBeCloseTo(REAL_USD + 17.5, 3);
  });

  it("sumFlowUsd 与 forecastBurnFromFlow 都走阶段混合价", () => {
    expect(sumFlowUsd([REAL])).toBeCloseTo(REAL_USD, 3);
    expect(sumFlowUsd([REAL, LEGACY])).toBeCloseTo(REAL_USD + 17.5, 3);
    const forecast = forecastBurnFromFlow(REAL, 10);
    expect(forecast.remainingUsd).toBeCloseTo(10 - REAL_USD, 3);
    expect(forecast.ratePerHourUsd).toBeCloseTo(REAL_USD, 3);
    expect(forecast.exhausted).toBe(false);
  });

  it("budgetReviewItem 优先用传入的阶段混合美元数；不传时维持旧口径", () => {
    const withUsd = budgetReviewItem(202671, { maxUsd: 5 }, REAL_USD);
    expect(withUsd).not.toBeNull();
    expect(withUsd!.detail).toContain("$5.83");
    expect(budgetReviewItem(202671, { maxUsd: 5 })).toBeNull();
    expect(budgetReviewItem(202671, { maxUsd: 5 }, Number.NaN)).toBeNull();
  });

  it("view-state 把阶段混合美元数传给 budgetReviewItem；run-budget/burn-forecast 不再自算模型键", () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8");
    expect(src("server/view-state.ts")).toMatch(/budgetReviewItem\(\s*costSummary\.totalTokens,[\s\S]*?,\s*[A-Za-z_.]*totalUsd[A-Za-z_.()]*\s*,?\s*\)/);
    expect(src("runtime/run-budget.ts")).toContain("flowsUsdStageMix(");
    expect(src("runtime/run-budget.ts")).not.toContain("estimateCostUsd(");
    expect(src("metrics/burn-forecast.ts")).toContain("flowUsdStageMix(");
    expect(src("metrics/burn-forecast.ts")).not.toContain("estimateCostUsd(");
  });
});