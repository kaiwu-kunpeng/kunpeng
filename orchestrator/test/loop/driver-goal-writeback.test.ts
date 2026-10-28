import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoopWave } from "../../src/loop/driver.js";
import { recipeRegistry, type LoopRecipe, type WaveResult } from "../../src/loop/recipe.js";
import type { LoopDef, Wave } from "../../src/loop/types.js";

const RID = "acme-links";
function loop(over: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "acme-links", name: "Acme Links", projectId: "acme-shop", recipe: RID, autonomous: true,
    metric: { key: "linkDefects", label: "缺陷", current: 10 },
    levers: [{ id: "crawl", label: "抓", status: "active", level: "L0" }],
    nextLever: { lever: "crawl", target: "https://acme.example/" }, waves: [], createdAt: 100, updatedAt: 100, ...over,
  };
}
function recipe(result: WaveResult, runWave = vi.fn(async () => result)): LoopRecipe {
  return { id: RID, listLevers: (def) => def.levers, readMetric: async (def) => def.metric.current, runWave };
}
const appended: Wave = { seq: 1, at: 999, lever: "crawl", subject: "https://acme.example/", metricDelta: -3, metricAfter: 7, verified: true, level: "L0" };

let repoRoot: string;
beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "kp-driver-goal-"));
  execFileSync("git", ["init", "--quiet", repoRoot]);
  recipeRegistry[RID] = recipe({ metricBefore: 10, metricAfter: 7, metricDelta: -3, verified: true, level: "L0", goalMetricCurrent: 7, evidence: "/s/snap.json" });
});
afterEach(() => { delete recipeRegistry[RID]; });

describe("runLoopWave 目标回填与等级透传（作者锁定）", () => {
  test("有 goalId 且结果带 goalMetricCurrent → setCurrent(goalId, 值, loop:<id>)；wave/ledger 带 level", async () => {
    const setCurrent = vi.fn(async () => ({}));
    const appendWave = vi.fn(async () => appended);
    const runWave = vi.fn(async () => ({ metricBefore: 10, metricAfter: 7, metricDelta: -3, verified: true, level: "L0" as const, goalMetricCurrent: 7, evidence: "/s/snap.json" }));
    const r = await runLoopWave("acme-links", {
      repoRoot,
      store: { read: vi.fn(async () => loop({ goalId: "goal-acme-links" })), appendWave },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: vi.fn(() => recipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }, runWave)),
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      goalStore: { setCurrent },
      now: () => 999,
    });
    expect(r.gated).toBe(false);
    expect(setCurrent).toHaveBeenCalledWith("goal-acme-links", 7, "loop:acme-links");
    expect(appendWave).toHaveBeenCalledWith("acme-links", expect.objectContaining({ level: "L0" }));
    expect(runWave).toHaveBeenCalledWith(expect.anything(), "crawl", "https://acme.example/", expect.objectContaining({ repoPath: "/acme/repo", repoRoot }));
  });

  test("没 goalId → 不回填；setCurrent 抛错也不让波次失败", async () => {
    const setCurrent = vi.fn(async () => { throw new Error("goal store down"); });
    const base = {
      repoRoot,
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      resolveRepoPath: vi.fn(async () => "/acme/repo"),
      goalStore: { setCurrent },
      now: () => 999,
    };
    const noGoal = await runLoopWave("acme-links", { ...base, store: { read: vi.fn(async () => loop()), appendWave: vi.fn(async () => appended) } });
    expect(noGoal.gated).toBe(false);
    expect(setCurrent).not.toHaveBeenCalled();
    const withGoal = await runLoopWave("acme-links", { ...base, store: { read: vi.fn(async () => loop({ goalId: "goal-acme-links" })), appendWave: vi.fn(async () => appended) } });
    expect(withGoal.gated).toBe(false);
    expect(setCurrent).toHaveBeenCalledTimes(1);
  });
});