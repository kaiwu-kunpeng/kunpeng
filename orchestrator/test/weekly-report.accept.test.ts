import { describe, expect, it } from "vitest";
import { buildWeeklyReport } from "../src/metrics/weekly-report.js";

const flow = (id: string, status: string, usd: number, cacheRead: number) => ({
  id, status, at: 1000, usd,
  tokens: { input: 100, output: 200, cacheCreate: 100, cacheRead },
});

describe("用量周报(作者验收)", () => {
  it("汇总小节齐全", () => {
    const md = buildWeeklyReport({
      flows: [flow("a", "verified", 1.5, 800), flow("b", "failed", 0.5, 0)],
      sinceMs: 0, untilMs: 2000,
    });
    expect(md).toContain("verified");
    expect(md).toMatch(/成功率|verified 率/);
    expect(md).toMatch(/命中率/);
    expect(md).toMatch(/\$/);
    expect(md).toMatch(/50\.0/);
  });
  it("Top 最贵流列出", () => {
    const md = buildWeeklyReport({ flows: [flow("cheap", "verified", 0.1, 0), flow("pricey", "verified", 9.9, 0)], sinceMs: 0, untilMs: 2000 });
    expect(md.indexOf("pricey")).toBeGreaterThan(-1);
  });
  it("零流量", () => {
    const md = buildWeeklyReport({ flows: [], sinceMs: 0, untilMs: 2000 });
    expect(md).toContain("本周无流量");
  });
});