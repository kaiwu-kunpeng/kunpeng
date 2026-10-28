import { expect, test, vi } from "vitest";
import { getRecipe, recipeRegistry, type LoopRecipe } from "./recipe.js";
import { recordLoopWave } from "../cli.js";
import type { LoopDef, Wave } from "./types.js";

function sampleLoop(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "loop-1",
    name: "Loop One",
    projectId: "project-1",
    recipe: "neutral-catalog",
    metric: { key: "score", label: "Score", current: 12 },
    levers: [
      { id: "ship", label: "Ship", status: "active" },
      { id: "docs", label: "Docs", status: "needs-dev" },
    ],
    waves: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("recipeRegistry returns registered recipes and rejects unknown ids", async () => {
  const recipe: LoopRecipe = {
    id: "test-recipe",
    listLevers(def) {
      return def.levers;
    },
    async readMetric(def) {
      return def.metric.current;
    },
  };
  recipeRegistry[recipe.id] = recipe;

  expect(getRecipe(recipe.id)).toBe(recipe);
  expect(() => getRecipe("missing")).toThrow(/missing/);

  delete recipeRegistry[recipe.id];
});

test("a neutral recipe registers, lists loop levers, and reads the current metric", async () => {
  const neutralRecipe: LoopRecipe = {
    id: "neutral-catalog",
    listLevers(def) {
      return def.levers;
    },
    async readMetric(def) {
      return def.metric.current;
    },
  };
  recipeRegistry[neutralRecipe.id] = neutralRecipe;

  const loop = sampleLoop();
  const recipe = getRecipe(neutralRecipe.id);

  expect(recipeRegistry[neutralRecipe.id]).toBe(neutralRecipe);
  expect(recipe).toBe(neutralRecipe);
  expect(recipe.id).toBe(neutralRecipe.id);
  expect(recipe.listLevers(loop)).toEqual(loop.levers);
  await expect(recipe.readMetric(loop)).resolves.toBe(loop.metric.current);

  delete recipeRegistry[neutralRecipe.id];
});

test("recordLoopWave maps record args into a wave and mirrored flow-state", async () => {
  const appended: Wave = {
    seq: 7,
    at: 12345,
    lever: "ship",
    subject: "ship catalog parser",
    metricDelta: 4,
    metricAfter: 16,
    commit: "abc123",
    deploy: "preview",
    verified: true,
    detail: "smoke passed",
    gotchas: ["first", "second"],
  };
  const appendWave = vi.fn().mockResolvedValue(appended);
  const start = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn().mockResolvedValue(undefined);

  const result = await recordLoopWave({
    id: "catalog",
    lever: "ship",
    subject: "ship catalog parser",
    delta: 4,
    after: 16,
    commit: "abc123",
    deploy: "preview",
    verified: true,
    detail: "smoke passed",
    gotchas: ["first", "second"],
  }, {
    store: { appendWave },
    tracker: { start, finish },
    now: () => 12345,
  });

  expect(appendWave).toHaveBeenCalledWith("catalog", {
    at: 12345,
    lever: "ship",
    subject: "ship catalog parser",
    metricDelta: 4,
    metricAfter: 16,
    commit: "abc123",
    deploy: "preview",
    verified: true,
    detail: "smoke passed",
    gotchas: ["first", "second"],
  });
  expect(start).toHaveBeenCalledWith("loop-catalog-w7", "ship catalog parser");
  expect(finish).toHaveBeenCalledWith("loop-catalog-w7", "verified");
  expect(result).toEqual({ wave: appended, flowId: "loop-catalog-w7" });
});

test("recordLoopWave mirrors an UNVERIFIED wave as a rolled-back flow (never inflates success rate)", async () => {
  const appended: Wave = {
    seq: 3,
    at: 999,
    lever: "ship",
    subject: "unverified wave",
    metricDelta: 1,
    metricAfter: 9,
    verified: false,
  };
  const appendWave = vi.fn().mockResolvedValue(appended);
  const start = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn().mockResolvedValue(undefined);

  await recordLoopWave({
    id: "catalog",
    lever: "ship",
    subject: "unverified wave",
    delta: 1,
    after: 9,
    verified: false,
  }, { store: { appendWave }, tracker: { start, finish }, now: () => 999 });

  // 关键真实性不变式：未带 --verified 的 wave 镜像成 rolled-back，绝不报 verified。
  expect(start).toHaveBeenCalledWith("loop-catalog-w3", "unverified wave");
  expect(finish).toHaveBeenCalledWith(
    "loop-catalog-w3",
    "rolled-back",
    undefined,
    expect.stringContaining("[loop-wave-unverified]"),
  );
});
