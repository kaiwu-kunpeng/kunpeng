import { expect, test } from "vitest";
import { runPool } from "../src/plan/pool.js";

test("runs all items and preserves result order", async () => {
  const out = await runPool([1, 2, 3, 4], 2, async (x) => x * 10);
  expect(out).toEqual([10, 20, 30, 40]);
});

test("never exceeds concurrency cap N", async () => {
  let active = 0, peak = 0;
  await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
  });
  expect(peak).toBeLessThanOrEqual(2);
});
