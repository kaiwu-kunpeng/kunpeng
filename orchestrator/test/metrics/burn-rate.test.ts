import { expect, test } from "vitest";
import { hoursToCapacity, willExceedWithin } from "../../src/metrics/burn-rate.js";

test("predicts hours to cap", () => {
  expect(hoursToCapacity({ spentUsd: 6, budgetUsd: 10, ratePerHourUsd: 2 })).toBe(2);
  expect(hoursToCapacity({ spentUsd: 12, budgetUsd: 10, ratePerHourUsd: 2 })).toBe(0);
  expect(hoursToCapacity({ spentUsd: 1, budgetUsd: 10, ratePerHourUsd: 0 })).toBeNull();
});
test("willExceedWithin", () => {
  expect(willExceedWithin({ spentUsd: 6, budgetUsd: 10, ratePerHourUsd: 2 }, 3)).toBe(true);
  expect(willExceedWithin({ spentUsd: 6, budgetUsd: 10, ratePerHourUsd: 2 }, 1)).toBe(false);
  expect(willExceedWithin({ spentUsd: 1, budgetUsd: 10, ratePerHourUsd: 0 }, 100)).toBe(false);
});