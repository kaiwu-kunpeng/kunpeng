import { expect, test } from "vitest";
import { computeRatios } from "../../src/metrics/dual-estimate.js";

test("compression = (orig - aiEst) / orig; realization null when no actual", () => {
  const r = computeRatios({ origHours: 8, aiEstHours: 3 });
  expect(r.compression).toBeCloseTo(0.625, 5);
  expect(r.realization).toBeNull();
});

test("realization = (orig - actual) / (orig - aiEst) when actual present", () => {
  const r = computeRatios({ origHours: 8, aiEstHours: 3, actualHours: 4 });
  expect(r.realization).toBeCloseTo(0.8, 5);
});

test("guards against divide-by-zero", () => {
  expect(computeRatios({ origHours: 0, aiEstHours: 0 }).compression).toBe(0);
  expect(computeRatios({ origHours: 5, aiEstHours: 5, actualHours: 3 }).realization).toBe(0);
});