import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../src/chat/conversation-store.js";

describe("有界并发 map(作者验收)", () => {
  it("保序 + 全部处理", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => x * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("空数组 → []", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
  });

  it("并发峰值不超过 limit", async () => {
    let active = 0, peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_v, i) => i), 3, async (x) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return x;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("limit<=0 仍完成", async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x + 1)).toEqual([2, 3]);
  });
});