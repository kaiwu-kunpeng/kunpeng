import { describe, expect, test, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runLoopWave } from "./driver.js";
import type { LoopDef, Wave } from "./types.js";
import type { LoopRecipe } from "./recipe.js";

function loop(): LoopDef {
  return {
    id: "acme-catalog",
    name: "Acme Catalog",
    projectId: "acme-shop",
    recipe: "acme-catalog",
    autonomous: true,
    metric: { key: "pwq", label: "PWQ", current: 10 },
    levers: [{ id: "model-expand", label: "Model expand", status: "active" }],
    nextLever: { lever: "model-expand", target: "RADIATOR" },
    waves: [],
    createdAt: 100,
    updatedAt: 100,
  };
}

describe("runLoopWave 记忆复利", () => {
  test("runWave 前把最近经验注入 recipeDeps.recentLearnings", async () => {
    const runWave = vi.fn(async () => ({ metricBefore: 10, metricAfter: 12, metricDelta: 2, verified: true }));
    const recipeObj: LoopRecipe = {
      id: "acme-catalog",
      listLevers: (def) => def.levers,
      readMetric: async (def) => def.metric.current,
      runWave,
    };
    const appended: Wave = { seq: 2, at: 999, lever: "model-expand", subject: "RADIATOR", metricDelta: 2, metricAfter: 12, verified: true };
    const recent = vi.fn(async () => [
      { at: 1, waveSeq: 1, lever: "model-expand", subject: "S", kind: "note" as const, lesson: "抓取前先确认换区生效" },
    ]);
    const append = vi.fn(async () => undefined);

    const result = await runLoopWave("acme-catalog", {
      repoRoot: await mkdtemp(join(tmpdir(), "kp-w3-")),
      store: { read: vi.fn(async () => loop()), appendWave: vi.fn(async () => appended) },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() => recipeObj),
      resolveRepoPath: vi.fn(async () => "/repo"),
      learningStore: { recent, append },
      now: () => 999,
    });

    expect(result.gated).toBe(false);
    expect(recent).toHaveBeenCalledWith("acme-catalog", 5);
    expect(runWave).toHaveBeenCalledWith(
      expect.anything(),
      "model-expand",
      "RADIATOR",
      expect.objectContaining({
        repoPath: "/repo",
        recentLearnings: [expect.objectContaining({ lesson: "抓取前先确认换区生效" })],
      }),
    );
  });

  test("learningStore 无 recent 时注入空数组，不抛", async () => {
    const runWave = vi.fn(async () => ({ metricBefore: 10, metricAfter: 10, metricDelta: 0, verified: true }));
    const recipeObj: LoopRecipe = {
      id: "acme-catalog",
      listLevers: (def) => def.levers,
      readMetric: async (def) => def.metric.current,
      runWave,
    };
    const appended: Wave = { seq: 2, at: 999, lever: "model-expand", subject: "RADIATOR", metricDelta: 0, metricAfter: 10, verified: true };
    await runLoopWave("acme-catalog", {
      repoRoot: await mkdtemp(join(tmpdir(), "kp-w3b-")),
      store: { read: vi.fn(async () => loop()), appendWave: vi.fn(async () => appended) },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() => recipeObj),
      resolveRepoPath: vi.fn(async () => "/repo"),
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 999,
    });
    expect(runWave).toHaveBeenCalledWith(
      expect.anything(),
      "model-expand",
      "RADIATOR",
      expect.objectContaining({ recentLearnings: [] }),
    );
  });
});