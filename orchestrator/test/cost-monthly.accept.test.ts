import { describe, expect, it } from "vitest";
import { buildMonthlyCostReport } from "../src/runtime/cost-monthly.js";

const JULY = Date.UTC(2026, 6, 5);
const JUNE = Date.UTC(2026, 5, 20);

describe("月度成本报表(作者验收)", () => {
  it("按月×模型分组求和并算 USD,月份降序", () => {
    const rows = buildMonthlyCostReport([
      { updatedAt: JULY, stageTokens: { implement: 1_000_000 }, stageModels: { implement: "gpt-5.6-sol@xhigh" } },
      { updatedAt: JULY, stageTokens: { implement: 500_000 }, stageModels: { implement: "gpt-5.6-sol@xhigh" } },
      { updatedAt: JUNE, stageTokens: { implement: 200 }, stageBackends: { implement: "claude" } },
    ]);
    expect(rows[0].month).toBe("2026-07");
    expect(rows[0].model).toBe("gpt-5.6-sol@xhigh");
    expect(rows[0].tokens).toBe(1_500_000);
    expect(rows[0].usd).toBeGreaterThan(0);
    expect(rows[rows.length - 1].month).toBe("2026-06");
  });

  it("标签回退链 stageModels→stageBackends→backend→unknown", () => {
    const rows = buildMonthlyCostReport([
      { updatedAt: JULY, stageTokens: { verify: 10 }, backend: "codex" },
      { updatedAt: JULY, stageTokens: { audit: 5 } },
    ]);
    const models = rows.map((r) => r.model).sort();
    expect(models).toContain("codex");
    expect(models).toContain("unknown");
  });

  it("脏数据与缺 updatedAt 跳过,不抛异常", () => {
    const rows = buildMonthlyCostReport([
      { stageTokens: { implement: 100 } },
      { updatedAt: JULY, stageTokens: { implement: Number.NaN } },
      { updatedAt: JULY, stageTokens: { implement: -5 } },
    ]);
    expect(rows.length).toBe(0);
  });
});