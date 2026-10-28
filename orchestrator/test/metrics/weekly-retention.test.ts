import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWeeklyReport } from "../../src/metrics/weekly-report.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("P3 周报留存漏斗 + 清退", () => {
  it("周报含留存漏斗三率", () => {
    const now = 1_700_000_000_000;
    const report = buildWeeklyReport({
      flows: [
        { id: "f1", status: "verified", at: now - 1000, merged: true },
        { id: "f2", status: "verified", at: now - 2000 },
        { id: "f3", status: "rolled-back", at: now - 3000 },
        { id: "f4", status: "verified", at: now - 4000, merged: true },
      ],
      sinceMs: now - 86_400_000,
      untilMs: now,
    });
    expect(report).toContain("留存漏斗");
    expect(report).toContain("50%");
  });

  it("六个无锚点模块已清退(perf-sample 因 stage-duration 依赖保留),正身仍在", () => {
    expect(existsSync(join(root, "src", "metrics", "flow-metrics.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "metrics", "anti-goodhart.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "metrics", "blame-attribution.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "verify", "affected-tests.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "loop", "compaction.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "perf", "perf-optimize.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "perf", "perf-sample.ts"))).toBe(true);
    expect(existsSync(join(root, "src", "perf", "perf-diff.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "perf", "stage-duration.ts"))).toBe(true);
    expect(existsSync(join(root, "src", "metrics", "retention.ts"))).toBe(true);
  });
});