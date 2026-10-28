import { expect, test } from "vitest";
import { checkup } from "../../src/metrics/paradigm-checkup.js";

test("computes level distribution and L3 ratio", () => {
  const c = checkup(["L3", "L3", "L2", "L1", "L3"]);
  expect(c.distribution).toEqual({ L1: 1, L2: 1, L3: 3 });
  expect(c.total).toBe(5);
  expect(c.l3Ratio).toBeCloseTo(0.6, 6);
});
test("empty is safe", () => {
  expect(checkup([])).toEqual({ distribution: { L1: 0, L2: 0, L3: 0 }, total: 0, l3Ratio: 0 });
});