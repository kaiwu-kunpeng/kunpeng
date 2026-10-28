import { expect, test } from "vitest";
import { decidePerf } from "../src/design/perf-budget.js";
import { FakeTierProbe, aggregateTierSignals } from "../src/design/tier-signals.js";
import { twoTierDecision } from "../src/verify/tier-gate.js";

test("FakeTierProbe returns deterministic clean defaults", async () => {
  const raw = await new FakeTierProbe().probe({ html: "<x/>" });

  expect(raw.axeViolations).toEqual([]);
  expect(raw.perfMetrics).toEqual({
    lcpMs: 1000,
    cls: 0.01,
    tbtMs: 50,
    totalBytes: 500_000,
  });
  expect(decidePerf(raw.perfMetrics).withinBudget).toBe(true);
  expect("visualDiff" in raw).toBe(false);
  expect("baselineChanged" in raw).toBe(false);
});

test("FakeTierProbe shallow-merges canned signals over defaults", async () => {
  const violation = { id: "color-contrast", impact: "serious" };
  const raw = await new FakeTierProbe({ axeViolations: [violation] }).probe({ url: "https://example.test" });

  expect(raw.axeViolations).toEqual([violation]);
  expect(raw.perfMetrics).toEqual({
    lcpMs: 1000,
    cls: 0.01,
    tbtMs: 50,
    totalBytes: 500_000,
  });
});

test("aggregate clean fake signals into a new-baseline human review decision", async () => {
  const raw = await new FakeTierProbe().probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: true, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.a11yGateable).toBe(true);
  expect(input.perfWithinBudget).toBe(true);
  expect(input.visualMatchesBaseline).toBe(true);
  expect(input.hasNewOrChangedBaseline).toBe(true);
  expect(decision.needsHumanReview).toBe(true);
  expect(decision.tier1AutoPass).toBe(false);
  expect(decision.blockers).toEqual([]);
});

test("aggregate matching existing baseline into tier1 auto-pass", async () => {
  const raw = await new FakeTierProbe({
    visualDiff: { diffPixels: 0, totalPixels: 1000 },
  }).probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: true, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.visualMatchesBaseline).toBe(true);
  expect(input.hasNewOrChangedBaseline).toBe(false);
  expect(decision.tier1AutoPass).toBe(true);
});

test("aggregate mismatching unchanged baseline into visual blocker", async () => {
  const raw = await new FakeTierProbe({
    visualDiff: { diffPixels: 999, totalPixels: 1000 },
  }).probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: true, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.visualMatchesBaseline).toBe(false);
  expect(input.hasNewOrChangedBaseline).toBe(false);
  expect(decision.blockers).toContain("视觉与基线不符");
  expect(decision.tier1AutoPass).toBe(false);
  expect(decision.needsHumanReview).toBe(false);
});

test("aggregate critical axe violation into a11y blocker", async () => {
  const raw = await new FakeTierProbe({
    axeViolations: [{ id: "aria-required-attr", impact: "critical" }],
    visualDiff: { diffPixels: 0, totalPixels: 1000 },
  }).probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: true, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.a11yGateable).toBe(false);
  expect(decision.blockers).toContain("a11y 不可门");
});

test("aggregate over-budget perf metrics into perf blocker", async () => {
  const raw = await new FakeTierProbe({
    perfMetrics: { lcpMs: 9999, cls: 0.01, tbtMs: 50, totalBytes: 500_000 },
    visualDiff: { diffPixels: 0, totalPixels: 1000 },
  }).probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: true, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.perfWithinBudget).toBe(false);
  expect(decision.blockers).toContain("性能超预算");
});

test("aggregate passes upstream build and behavior signals through", async () => {
  const raw = await new FakeTierProbe({
    visualDiff: { diffPixels: 0, totalPixels: 1000 },
  }).probe({ html: "" });
  const input = aggregateTierSignals(raw, { buildPassed: false, behaviorPassed: true });
  const decision = twoTierDecision(input);

  expect(input.buildPassed).toBe(false);
  expect(input.behaviorPassed).toBe(true);
  expect(decision.blockers).toContain("build 失败");
});
