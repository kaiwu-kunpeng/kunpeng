import { expect, test } from "vitest";
import { costUsd } from "../../src/metrics/cache-cost.js";

const prices = { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 };

test("prices each quadrant separately and sums", () => {
  const r = costUsd(
    { freshInput: 1_000_000, cacheCreate: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 },
    prices,
  );
  expect(r.byQuadrant.freshInput).toBeCloseTo(3, 6);
  expect(r.byQuadrant.cacheCreate).toBeCloseTo(3.75, 6);
  expect(r.byQuadrant.cacheRead).toBeCloseTo(0.3, 6);
  expect(r.byQuadrant.output).toBeCloseTo(15, 6);
  expect(r.total).toBeCloseTo(22.05, 6);
});

test("cache-read is far cheaper than fresh input (no over-count)", () => {
  const cached = costUsd({ freshInput: 0, cacheCreate: 0, cacheRead: 1_000_000, output: 0 }, prices);
  const fresh = costUsd({ freshInput: 1_000_000, cacheCreate: 0, cacheRead: 0, output: 0 }, prices);
  expect(cached.total).toBeLessThan(fresh.total);
});