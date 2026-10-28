import { expect, test } from "vitest";
import { DEFAULT_PERF_BUDGET, decidePerf } from "../src/design/perf-budget.js";

test("all metrics within custom budget pass with no overages", () => {
  const result = decidePerf(
    { lcpMs: 1200, cls: 0.02, tbtMs: 80, totalBytes: 700_000 },
    { lcpMs: 2000, cls: 0.05, tbtMs: 100, totalBytes: 900_000 },
  );

  expect(result.withinBudget).toBe(true);
  expect(result.overages).toEqual([]);
});

test("omitted budget uses DEFAULT_PERF_BUDGET", () => {
  const result = decidePerf({ lcpMs: 2400, cls: 0.09, tbtMs: 199, totalBytes: 1_500_000 });

  expect(DEFAULT_PERF_BUDGET).toEqual({
    lcpMs: 2500,
    cls: 0.1,
    tbtMs: 200,
    totalBytes: 1_600_000,
  });
  expect(result.withinBudget).toBe(true);
  expect(result.overages).toEqual([]);
});

test("single metric over budget reports exact overage", () => {
  const result = decidePerf({ lcpMs: 3000, cls: 0.05, tbtMs: 100, totalBytes: 1_000_000 });

  expect(result.withinBudget).toBe(false);
  expect(result.overages).toEqual(["lcpMs 3000 > 2500"]);
});

test("multiple overages preserve lcpMs, cls, tbtMs, totalBytes order", () => {
  const result = decidePerf({ lcpMs: 3000, cls: 0.2, tbtMs: 250, totalBytes: 2_000_000 });

  expect(result.withinBudget).toBe(false);
  expect(result.overages).toEqual([
    "lcpMs 3000 > 2500",
    "cls 0.2 > 0.1",
    "tbtMs 250 > 200",
    "totalBytes 2000000 > 1600000",
  ]);
});

test("metrics equal to the budget limit are within budget", () => {
  const result = decidePerf(DEFAULT_PERF_BUDGET);

  expect(result.withinBudget).toBe(true);
  expect(result.overages).toEqual([]);
});

test("custom budget overrides defaults", () => {
  const result = decidePerf(
    { lcpMs: 2400, cls: 0.09, tbtMs: 199, totalBytes: 1_500_000 },
    { lcpMs: 2300, cls: 0.08, tbtMs: 180, totalBytes: 1_400_000 },
  );

  expect(result.withinBudget).toBe(false);
  expect(result.overages).toEqual([
    "lcpMs 2400 > 2300",
    "cls 0.09 > 0.08",
    "tbtMs 199 > 180",
    "totalBytes 1500000 > 1400000",
  ]);
});
