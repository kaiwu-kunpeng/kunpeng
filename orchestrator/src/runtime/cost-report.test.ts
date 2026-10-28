import { describe, expect, test } from "vitest";
import { buildCostReport, formatCostReport } from "./cost-report.js";

describe("buildCostReport", () => {
  test("empty stages → zeros", () => {
    const r = buildCostReport([]);
    expect(r.totalTokens).toBe(0);
    expect(r.tokensByModel).toEqual({});
    expect(r.cost.totalUsd).toBe(0);
    expect(r.budget).toBeUndefined();
  });

  test("groups tokens by model and sums total", () => {
    const r = buildCostReport([
      { stage: "spec", model: "claude-opus-4-8", tokens: 1000 },
      { stage: "impl", model: "claude-opus-4-8", tokens: 2000 },
      { stage: "review", model: "claude-sonnet-4-6", tokens: 500 },
    ]);
    expect(r.totalTokens).toBe(3500);
    expect(r.tokensByModel).toEqual({ "claude-opus-4-8": 3000, "claude-sonnet-4-6": 500 });
    // 混合价 opus $15/Mtok: 3000/1e6*15 = 0.045; sonnet-4-6 $9/Mtok: 500/1e6*9 = 0.0045
    expect(r.cost.totalUsd).toBeCloseTo(0.0495, 6);
  });

  test("budget present only when passed; reflects over-budget", () => {
    const stages = [{ stage: "impl", model: "claude-opus-4-8", tokens: 5000 }];
    const noB = buildCostReport(stages);
    expect(noB.budget).toBeUndefined();
    const withB = buildCostReport(stages, { maxTokens: 1000 });
    expect(withB.budget?.over).toBe(true);
    expect(withB.budget?.reason).toBe("tokens");
  });
});

describe("formatCostReport", () => {
  test("contains total tokens, usd 2dp, model count", () => {
    const txt = formatCostReport(buildCostReport([
      { stage: "a", model: "claude-opus-4-8", tokens: 1000 },
      { stage: "b", model: "codex", tokens: 1000 },
    ]));
    expect(txt).toContain("总 2000 tokens");
    expect(txt).toContain("2 模型");
    expect(txt).toMatch(/\$\d+\.\d{2}/);
  });

  test("appends 超预算 when over budget", () => {
    const txt = formatCostReport(buildCostReport(
      [{ stage: "a", model: "claude-opus-4-8", tokens: 9000 }],
      { maxTokens: 1000 },
    ));
    expect(txt).toContain("超预算");
  });

  test("no budget → no 超预算 / 已用 suffix", () => {
    const txt = formatCostReport(buildCostReport([{ stage: "a", model: "codex", tokens: 100 }]));
    expect(txt).not.toContain("超预算");
    expect(txt).not.toContain("已用");
  });
});