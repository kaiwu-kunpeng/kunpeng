import { describe, expect, test } from "vitest";
import {
  buildCostByProject,
  sumProjectCosts,
  type DashboardState,
  type ProjectSnapshot,
} from "../../src/server/state.js";

function snapshot(
  id: string,
  name: string,
  costSummary?: DashboardState["costSummary"],
): ProjectSnapshot {
  return {
    id,
    name,
    repoPath: `/${id}`,
    state: { costSummary } as DashboardState,
  };
}

const aCost: DashboardState["costSummary"] = {
  totalTokens: 1000,
  llmStages: 5,
  totalStages: 8,
  deterministicStages: 3,
  determinismRatio: 0.375,
  savedLlmCalls: 2,
  tokensByStage: { spec: 400, impl: 600 },
  tokensByModel: { low: 100 },
};

const bCost: DashboardState["costSummary"] = {
  totalTokens: 3000,
  llmStages: 7,
  totalStages: 10,
  deterministicStages: 4,
  determinismRatio: 0.4,
  savedLlmCalls: 3,
  tokensByStage: { impl: 3000 },
  tokensByModel: { low: 50, opus: 30 },
};

describe("cost by project", () => {
  test("buildCostByProject maps snapshots and sorts by token usage", () => {
    const result = buildCostByProject([
      snapshot("a", "Alpha", aCost),
      snapshot("b", "Beta", bCost),
    ]);

    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
    expect(result[0]).toMatchObject({ id: "b", name: "Beta", totalTokens: 3000 });
    expect(result[1]).toMatchObject({ id: "a", name: "Alpha", totalTokens: 1000 });
  });

  test("buildCostByProject tolerates snapshots without cost summaries", () => {
    const result = buildCostByProject([
      snapshot("empty", "Empty", undefined),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].totalTokens).toBe(0);
    expect(result[0].tokensByStage).toEqual({});
  });

  test("sumProjectCosts totals tokens, calls, stages, and stage token buckets", () => {
    const list = buildCostByProject([
      snapshot("a", "Alpha", aCost),
      snapshot("b", "Beta", bCost),
    ]);

    const result = sumProjectCosts(list);

    expect(result.totalTokens).toBe(4000);
    expect(result.llmStages).toBe(12);
    expect(result.totalStages).toBe(18);
    expect(result.deterministicStages).toBe(7);
    expect(result.savedLlmCalls).toBe(5);
    expect(result.tokensByStage.impl).toBe(3600);
    expect(result.tokensByStage.spec).toBe(400);
    expect(result.tokensByModel).toEqual({ low: 150, opus: 30 });
    expect(result.determinismRatio).toBe(result.deterministicStages / result.totalStages);
  });

  test("sumProjectCosts returns zero summary for an empty list", () => {
    const result = sumProjectCosts([]);

    expect(result.totalTokens).toBe(0);
    expect(result.llmStages).toBe(0);
    expect(result.totalStages).toBe(0);
    expect(result.deterministicStages).toBe(0);
    expect(result.savedLlmCalls).toBe(0);
    expect(result.determinismRatio).toBe(0);
    expect(result.tokensByStage).toEqual({});
    expect(result.tokensByModel).toEqual({});
  });
});
