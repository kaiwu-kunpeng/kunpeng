import { expect, test } from "vitest";
import { twoTierDecision } from "../src/verify/tier-gate.js";
import type { TierGateInput } from "../src/verify/tier-gate.js";

const clean: TierGateInput = {
  buildPassed: true,
  behaviorPassed: true,
  a11yGateable: true,
  perfWithinBudget: true,
  visualMatchesBaseline: true,
  hasNewOrChangedBaseline: false,
};

// 用例 1：全确定性过 + 无新基线 → 自动放行
test("全过 + 无新基线 → tier1AutoPass，无人审，blockers 空", () => {
  const r = twoTierDecision(clean);
  expect(r.tier1AutoPass).toBe(true);
  expect(r.needsHumanReview).toBe(false);
  expect(r.blockers).toEqual([]);
});

// 用例 2：某确定性信号失败 → 硬拦，非放行
test("a11y 不可门 → tier1AutoPass=false 且 blockers 非空", () => {
  const r = twoTierDecision({ ...clean, a11yGateable: false });
  expect(r.tier1AutoPass).toBe(false);
  expect(r.blockers.length).toBeGreaterThan(0);
});

// 用例 3：有新基线、其余 clean、视觉不符 → 转人审，不算硬拦
test("有新基线 + 视觉不符 → needsHumanReview，blockers 空", () => {
  const r = twoTierDecision({
    ...clean,
    visualMatchesBaseline: false,
    hasNewOrChangedBaseline: true,
  });
  expect(r.tier1AutoPass).toBe(false);
  expect(r.needsHumanReview).toBe(true);
  expect(r.blockers).toEqual([]);
});

// 用例 4：视觉不符且无新基线 → 含「视觉」的硬拦
test("视觉不符 + 无新基线 → blockers 含「视觉」，tier1AutoPass=false", () => {
  const r = twoTierDecision({ ...clean, visualMatchesBaseline: false });
  expect(r.tier1AutoPass).toBe(false);
  expect(r.blockers.some((b) => b.includes("视觉"))).toBe(true);
});
