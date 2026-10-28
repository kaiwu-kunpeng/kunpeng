import { describe, expect, test } from "vitest";
import {
  aggregateTokensByModel,
  sumProjectCosts,
  type ProjectCostSummary,
} from "../../src/server/state.js";

describe("tokens by model", () => {
  // 路由表(src/agent/model-routing.ts): codex 仅 implement=xhigh,其余阶段=low。
  test("aggregates codex stage tokens by effort", () => {
    expect(aggregateTokensByModel([
      { backend: "codex", stageTokens: { spec: 100, implement: 500, review: 50 } },
    ])).toEqual({ low: 150, xhigh: 500 });
  });

  // claude 全阶段归到 claude-opus-5(2026-09-07 CLAUDE_TIER 升级)。
  test("aggregates claude stage tokens by model id", () => {
    expect(aggregateTokensByModel([
      { backend: "claude", stageTokens: { spec: 80, implement: 300, design: 200 } },
    ])).toEqual({ "claude-opus-5": 580 });
  });

  test("defaults missing backend to codex and sums multiple flows", () => {
    expect(aggregateTokensByModel([
      { stageTokens: { implement: 10 } },
      { backend: "codex", stageTokens: { implement: 5 } },
    ])).toEqual({ xhigh: 15 });
  });

  test("ignores flows without stage tokens", () => {
    expect(aggregateTokensByModel([
      { backend: "codex" },
      { backend: "claude", stageTokens: {} },
    ])).toEqual({});
  });

  test("sumProjectCosts merges tokensByModel buckets", () => {
    const projects: ProjectCostSummary[] = [
      {
        id: "a",
        name: "A",
        totalTokens: 100,
        llmStages: 1,
        totalStages: 1,
        deterministicStages: 0,
        determinismRatio: 0,
        savedLlmCalls: 0,
        tokensByStage: {},
        tokensByModel: { low: 100 },
      },
      {
        id: "b",
        name: "B",
        totalTokens: 80,
        llmStages: 1,
        totalStages: 1,
        deterministicStages: 0,
        determinismRatio: 0,
        savedLlmCalls: 0,
        tokensByStage: {},
        tokensByModel: { low: 50, opus: 30 },
      },
    ];

    expect(sumProjectCosts(projects).tokensByModel).toEqual({ low: 150, opus: 30 });
  });
});