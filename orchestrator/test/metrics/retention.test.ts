import { expect, test } from "vitest";
import { retention } from "../../src/metrics/retention.js";

test("computes funnel rates", () => {
  const r = retention({ generated: 1000, committed: 800, inProd: 600 });
  expect(r.commitRate).toBeCloseTo(0.8, 6);
  expect(r.survivalRate).toBeCloseTo(0.6, 6);
  expect(r.reworkRate).toBeCloseTo(0.25, 6); // (800-600)/800
});
test("guards zeros", () => {
  expect(retention({ generated: 0, committed: 0, inProd: 0 })).toEqual({ commitRate: 0, survivalRate: 0, reworkRate: 0 });
});