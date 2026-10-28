import { describe, expect, it } from "vitest";
import { cacheHitRate, hitRateGrade } from "../src/metrics/cache-cost.js";

describe("缓存命中率(作者验收)", () => {
  it("命中率计算", () => {
    expect(cacheHitRate({ input: 100, cacheCreate: 100, cacheRead: 800 })).toBeCloseTo(0.8);
    expect(cacheHitRate({ input: 500, cacheCreate: 500, cacheRead: 0 })).toBe(0);
    expect(cacheHitRate({ input: 0, cacheCreate: 0, cacheRead: 0 })).toBeNull();
  });
  it("档位:≥50% good、≥20% warn、其余 bad、null n/a", () => {
    expect(hitRateGrade(0.8)).toBe("good");
    expect(hitRateGrade(0.5)).toBe("good");
    expect(hitRateGrade(0.3)).toBe("warn");
    expect(hitRateGrade(0.1)).toBe("bad");
    expect(hitRateGrade(null)).toBe("n/a");
  });
});