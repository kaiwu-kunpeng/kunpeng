import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runLoopWave } from "./driver.js";
import type { Learning } from "./learnings.js";
import type { LoopDef, Wave } from "./types.js";
import { recipeRegistry, type LoopRecipe, type WaveResult } from "./recipe.js";

const NEUTRAL_RECIPE_ID = "acme-catalog";

function loop(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "acme-catalog",
    name: "Acme Catalog",
    projectId: "acme-shop",
    recipe: "acme-catalog",
    metric: { key: "pwq", label: "PWQ", current: 10 },
    levers: [{ id: "model-expand", label: "Model expand", status: "active" }],
    nextLever: { lever: "model-expand", target: "RADIATOR" },
    waves: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function recipe(result: WaveResult, runWave = vi.fn(async () => result)): LoopRecipe {
  return {
    id: NEUTRAL_RECIPE_ID,
    listLevers: (def) => def.levers,
    readMetric: async (def) => def.metric.current,
    allowsUnlistedLever: (lever) => lever === "new-category",
    runWave,
  };
}

beforeEach(() => {
  recipeRegistry[NEUTRAL_RECIPE_ID] = recipe({
    metricBefore: 0,
    metricAfter: 0,
    metricDelta: 0,
    verified: true,
  });
});

afterEach(() => {
  delete recipeRegistry[NEUTRAL_RECIPE_ID];
});

async function createRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "kp-driver-"));
  execFileSync("git", ["init", "--quiet", repoRoot]);
  return repoRoot;
}

describe("runLoopWave", () => {
  test("gates non-autonomous loops and does not execute the recipe", async () => {
    const repoRoot = await createRepoRoot();
    const runWave = vi.fn();
    const appendWave = vi.fn();
    const start = vi.fn(async () => undefined);
    const finish = vi.fn(async () => undefined);

    const result = await runLoopWave("acme-catalog", {
      repoRoot,
      store: {
        read: vi.fn(async () => loop({ autonomous: false })),
        appendWave,
      },
      tracker: { start, finish },
      getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      now: () => 123,
    });

    expect(result.gated).toBe(true);
    expect(runWave).not.toHaveBeenCalled();
    expect(appendWave).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith("loop-acme-catalog-gate-123", "RADIATOR");
    expect(finish).toHaveBeenCalledWith(
      "loop-acme-catalog-gate-123",
      "rolled-back",
      expect.objectContaining({ gate: "运营 loop 对外推送" }),
      expect.stringContaining("[loop-gate]"),
    );
  });

  test("runs autonomous recipe, appends wave, preserves nextLever, and mirrors verified status", async () => {
    const repoRoot = await createRepoRoot();
    const sourceLoop = loop({ autonomous: true });
    const appended: Wave = {
      seq: 8,
      at: 999,
      lever: "model-expand",
      subject: "RADIATOR",
      metricDelta: 5,
      metricAfter: 15,
      commit: "sha",
      deploy: "READY:sha",
      verified: true,
      detail: "ok",
    };
    const appendWave = vi.fn(async () => appended);
    const runWave = vi.fn(async () => ({
      metricBefore: 10,
      metricAfter: 15,
      metricDelta: 5,
      commit: "sha",
      deploy: "READY:sha",
      verified: true,
      detail: "ok",
    }));
    const start = vi.fn(async () => undefined);
    const finish = vi.fn(async () => undefined);

    const result = await runLoopWave("acme-catalog", {
      repoRoot,
      store: { read: vi.fn(async () => sourceLoop), appendWave },
      tracker: { start, finish },
      getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      recipeDeps: { env: { XCRAWL_MCP_URL: "http://xcrawl" } },
      now: () => 999,
    });

    expect(result.gated).toBe(false);
    expect(runWave).toHaveBeenCalledWith(
      sourceLoop,
      "model-expand",
      "RADIATOR",
      expect.objectContaining({ repoPath: "/acme/repo" }),
    );
    expect(appendWave).toHaveBeenCalledWith("acme-catalog", {
      at: 999,
      lever: "model-expand",
      subject: "RADIATOR",
      metricDelta: 5,
      metricAfter: 15,
      commit: "sha",
      deploy: "READY:sha",
      verified: true,
      detail: "ok",
    });
    expect(sourceLoop.nextLever).toEqual({ lever: "model-expand", target: "RADIATOR" });
    expect(start).toHaveBeenCalledWith("loop-acme-catalog-w8", "RADIATOR");
    expect(finish).toHaveBeenCalledWith("loop-acme-catalog-w8", "verified");
  });

  test("mirrors unverified autonomous waves as rolled-back", async () => {
    const repoRoot = await createRepoRoot();
    const appendWave = vi.fn(async () => ({
      seq: 9,
      at: 1,
      lever: "model-expand",
      subject: "RADIATOR",
      metricDelta: 0,
      metricAfter: 10,
      verified: false,
    }));
    const finish = vi.fn(async () => undefined);

    await runLoopWave("acme-catalog", {
      repoRoot,
      store: { read: vi.fn(async () => loop({ autonomous: true })), appendWave },
      tracker: { start: vi.fn(async () => undefined), finish },
      getRecipe: vi.fn(() =>
        recipe({ metricBefore: 10, metricAfter: 10, metricDelta: 0, verified: false }),
      ),
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 1,
    });

    expect(finish).toHaveBeenCalledWith(
      "loop-acme-catalog-w9",
      "rolled-back",
      undefined,
      expect.stringContaining("[loop-wave-unverified]"),
    );
  });

  test("allows new-category next levers to reach the recipe", async () => {
    const repoRoot = await createRepoRoot();
    const sourceLoop = loop({
      autonomous: true,
      recipe: NEUTRAL_RECIPE_ID,
      nextLever: { lever: "new-category", target: JSON.stringify({ enumName: "STARTER" }) },
    });
    const appendWave = vi.fn(async () => ({
      seq: 10,
      at: 2,
      lever: "new-category",
      subject: JSON.stringify({ enumName: "STARTER" }),
      metricDelta: 3,
      metricAfter: 13,
      verified: true,
    }));
    const runWave = vi.fn(async () => ({
      metricBefore: 10,
      metricAfter: 13,
      metricDelta: 3,
      verified: true,
    }));

    await runLoopWave("acme-catalog", {
      repoRoot,
      store: { read: vi.fn(async () => sourceLoop), appendWave },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      now: () => 2,
    });

    expect(runWave).toHaveBeenCalledWith(
      sourceLoop,
      "new-category",
      JSON.stringify({ enumName: "STARTER" }),
      expect.objectContaining({ repoPath: "/acme/repo" }),
    );
    expect(appendWave).toHaveBeenCalledWith("acme-catalog", {
      at: 2,
      lever: "new-category",
      subject: JSON.stringify({ enumName: "STARTER" }),
      metricDelta: 3,
      metricAfter: 13,
      verified: true,
    });
  });

  test("rejects unsupported next levers", async () => {
    const repoRoot = await createRepoRoot();
    const runWave = vi.fn();
    const appendWave = vi.fn();

    await expect(
      runLoopWave("acme-catalog", {
        repoRoot,
        store: {
          read: vi.fn(async () => loop({ autonomous: true, nextLever: { lever: "docs", target: "RADIATOR" } })),
          appendWave,
        },
        tracker: { start: vi.fn(), finish: vi.fn() },
        getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      }),
    ).rejects.toThrow(/unsupported loop nextLever: docs/);
    expect(runWave).not.toHaveBeenCalled();
    expect(appendWave).not.toHaveBeenCalled();
  });

  test("resolves git repo path from loop projectId instead of process cwd", async () => {
    const cwdRepo = await createRepoRoot();
    const actualRepo = join(cwdRepo, "actual-repo");
    const stateDir = join(cwdRepo, "state");
    await mkdir(actualRepo, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "projects.json"),
      JSON.stringify({
        projects: [{ id: "acme-shop", name: "Acme", repoPath: actualRepo, registeredAt: 1 }],
      }),
      "utf8",
    );
    const runWave = vi.fn(async () => ({
      metricBefore: 10,
      metricAfter: 10,
      metricDelta: 0,
      verified: true,
    }));

    await runLoopWave("acme-catalog", {
      repoRoot: cwdRepo,
      stateDir,
      store: {
        read: vi.fn(async () => loop({ autonomous: true })),
        appendWave: vi.fn(async () => ({
          seq: 1,
          at: 1,
          lever: "model-expand",
          subject: "RADIATOR",
          metricDelta: 0,
          metricAfter: 10,
          verified: true,
        })),
      },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 1,
    });

    expect(runWave).toHaveBeenCalledWith(
      expect.any(Object),
      "model-expand",
      "RADIATOR",
      expect.objectContaining({ repoPath: actualRepo }),
    );
    expect(runWave).not.toHaveBeenCalledWith(
      expect.any(Object),
      "model-expand",
      "RADIATOR",
      expect.objectContaining({ repoPath: cwdRepo }),
    );
  });

  test("rejects loops without nextLever", async () => {
    const repoRoot = await createRepoRoot();
    await expect(
      runLoopWave("acme-catalog", {
        repoRoot,
        store: { read: vi.fn(async () => loop({ nextLever: undefined })), appendWave: vi.fn() },
        tracker: { start: vi.fn(), finish: vi.fn() },
      }),
    ).rejects.toThrow(/nextLever/);
  });

  test("appends derived learning after autonomous wave append", async () => {
    const repoRoot = await createRepoRoot();
    const sourceLoop = loop({
      autonomous: true,
      recipe: NEUTRAL_RECIPE_ID,
      nextLever: { lever: "new-category", target: JSON.stringify({ enumName: "VAPOR_CANISTER" }) },
    });
    const appended: Wave = {
      seq: 11,
      at: 1234,
      lever: "new-category",
      subject: JSON.stringify({ enumName: "VAPOR_CANISTER" }),
      metricDelta: 0,
      metricAfter: 10,
      verified: true,
      detail: "VAPOR_CANISTER new-category: 8 pages, 42 candidates, 0 priced suppliers",
    };
    const appendLearning = vi.fn(async (_id: string, _learning: Learning) => undefined);

    const result = await runLoopWave("acme-catalog", {
      repoRoot,
      store: { read: vi.fn(async () => sourceLoop), appendWave: vi.fn(async () => appended) },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() =>
        recipe({
          metricBefore: 10,
          metricAfter: 10,
          metricDelta: 0,
          verified: true,
          detail: "VAPOR_CANISTER new-category: 8 pages, 42 candidates, 0 priced suppliers",
        }),
      ),
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      learningStore: { append: appendLearning },
      now: () => 1234,
    });

    expect(result.gated).toBe(false);
    expect(appendLearning).toHaveBeenCalledOnce();
    expect(appendLearning).toHaveBeenCalledWith(
      "acme-catalog",
      expect.objectContaining({ kind: "weak", subject: "VAPOR_CANISTER" }),
    );
  });
});
