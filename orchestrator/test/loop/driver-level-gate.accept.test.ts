import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLoopWave } from "../../src/loop/driver.js";
import { createOpsGate, decideOpsGate, listOpsGates } from "../../src/loop/ops-gate.js";
import { defaultLeverLevelByName, recipeRegistry, resolveWaveLevel, type LoopRecipe, type WaveResult } from "../../src/loop/recipe.js";
import "../../src/loop/geo-monitor.js";
import "../../src/loop/agent-playbook.js";
import "../../src/loop/seo-internal-links.js";
import type { LoopDef, Wave } from "../../src/loop/types.js";

// 背景（2026-10-03 运营审计 A3 G3，总报告 P0-6）：L0–L4 在执行路径不生效——driver 只看 autonomous，三仓 18 个 loop 的
// lever level 全空，L3「对外可见」的推送（indexnow 等）和 L0 抓取走的是同一条路。本测试锁定：
//   ① recipe 给杠杆缺省等级（抓取/扫描类 L0，提交/发布类 L3，其余 L2），杠杆自己声明的优先；
//   ② driver 对 L3/L4 波次必须拿到「已批准、未消费、等级够」的运营门批条才跑，否则开门进收件箱并停在这一波；
//   ③ 一张批条只放行一波（consumedAt），等级不够的批条放不了行；台账/wave 记下本波等级。

const RID = "lvl-recipe";
let repoRoot: string;
function loop(over: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "lvl-loop", name: "Level Loop", projectId: "lvl-proj", recipe: RID, autonomous: true,
    metric: { key: "m", label: "M", current: 10 },
    levers: [{ id: "submit-indexnow", label: "提交", status: "active", level: "L3" }, { id: "crawl", label: "抓", status: "active" }],
    nextLever: { lever: "submit-indexnow", target: "https://x.example/" }, waves: [], createdAt: 1, updatedAt: 1, ...over,
  };
}
function recipe(runWave: LoopRecipe["runWave"]): LoopRecipe {
  return { id: RID, listLevers: (def) => def.levers, readMetric: async (def) => def.metric.current, defaultLeverLevel: defaultLeverLevelByName, runWave };
}
const okResult: WaveResult = { metricBefore: 10, metricAfter: 9, metricDelta: -1, verified: true };
function deps(def: LoopDef, runWave = vi.fn(async () => okResult)) {
  const appended: Wave[] = [];
  return {
    runWave, appended,
    deps: {
      repoRoot,
      store: { read: vi.fn(async () => def), appendWave: vi.fn(async (_id: string, w: Omit<Wave, "seq">) => { const wave = { seq: appended.length + 1, ...w } as Wave; appended.push(wave); return wave; }) },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: () => recipe(runWave),
      resolveRepoPath: async () => repoRoot,
      env: {},
      now: () => 5_000,
    },
  };
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "kp-lvl-"));
  execFileSync("git", ["init", "--quiet", repoRoot]);
});
afterEach(() => { delete recipeRegistry[RID]; rmSync(repoRoot, { recursive: true, force: true }); });

describe("driver 按杠杆等级走运营门（作者锁定）", () => {
  it("① 等级解析：杠杆声明优先；没声明问 recipe 缺省；按名猜级 抓取 L0 / 提交 L3 / 其余 L2；纯扫描 recipe 一律 L0", () => {
    const def = loop();
    const r = recipe(vi.fn());
    expect(resolveWaveLevel(def, "submit-indexnow", r)).toBe("L3");
    expect(resolveWaveLevel(def, "crawl", r)).toBe("L0");
    expect(resolveWaveLevel(def, "crawl", { })).toBeUndefined();
    expect(defaultLeverLevelByName("demo-geo-audit")).toBe("L0");
    expect(defaultLeverLevelByName("geo-sweep")).toBe("L0");
    expect(defaultLeverLevelByName("submit-indexnow")).toBe("L3");
    expect(defaultLeverLevelByName("demo-supplier-gate")).toBe("L2");
    expect(recipeRegistry["geo-monitor"]?.defaultLeverLevel?.("anything")).toBe("L0");
    expect(recipeRegistry["agent-playbook"]?.defaultLeverLevel?.("deploy-site")).toBe("L3");
    expect(recipeRegistry["seo-internal-links"]?.defaultLeverLevel?.("crawl")).toBe("L0");
  });

  it("② L3 杠杆没有批条：不跑 runWave，开一张 pending 运营门（带等级、loopId），再扫也只有这一张", async () => {
    const { deps: d, runWave } = deps(loop());
    const first = await runLoopWave("lvl-loop", d);
    expect(first.gated).toBe(true);
    if (first.gated) expect(first.humanGate.gate).toBe("运营 loop 动作等级门");
    expect(runWave).not.toHaveBeenCalled();
    let gates = await listOpsGates(repoRoot);
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ loopId: "lvl-loop", level: "L3", status: "pending", playbookId: "loop:lvl-loop:submit-indexnow" });
    const second = await runLoopWave("lvl-loop", d);
    expect(second.gated).toBe(true);
    gates = await listOpsGates(repoRoot);
    expect(gates).toHaveLength(1);
    expect(existsSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"))).toBe(false);
  });

  it("③ 人批准后：下一波放行、runWave 跑一次、批条标 consumedAt、wave 记 level；再下一波又要新批条", async () => {
    const { deps: d, runWave, appended } = deps(loop());
    await runLoopWave("lvl-loop", d);
    const pending = (await listOpsGates(repoRoot))[0]!;
    await decideOpsGate(repoRoot, pending.id, "approved", { by: "human", via: "test" });

    const run = await runLoopWave("lvl-loop", d);
    expect(run.gated).toBe(false);
    expect(runWave).toHaveBeenCalledTimes(1);
    expect(appended[0]?.level).toBe("L3");
    const ledger = readFileSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"), "utf8");
    expect(JSON.parse(ledger.trim().split("\n")[0]!)).toMatchObject({ loopId: "lvl-loop", level: "L3" });
    const consumed = (await listOpsGates(repoRoot)).find((g) => g.id === pending.id)!;
    expect(consumed.status).toBe("approved");
    expect(typeof consumed.consumedAt).toBe("number");

    const again = await runLoopWave("lvl-loop", d);
    expect(again.gated).toBe(true);
    expect(runWave).toHaveBeenCalledTimes(1);
    expect((await listOpsGates(repoRoot)).filter((g) => g.status === "pending")).toHaveLength(1);
  });

  it("③ 等级不够的批条放不了行：L3 批条对 L4 波无效，仍开新门", async () => {
    const def = loop({ levers: [{ id: "buy-ads", label: "买量", status: "active", level: "L4" }], nextLever: { lever: "buy-ads", target: "campaign-1" } });
    const low = await createOpsGate(repoRoot, { projectId: "lvl-proj", playbookId: "manual", loopId: "lvl-loop", reason: "r", level: "L3" }, 1);
    await decideOpsGate(repoRoot, low.id, "approved", { by: "human", via: "test" });
    const { deps: d, runWave } = deps(def);
    const r = await runLoopWave("lvl-loop", d);
    expect(r.gated).toBe(true);
    expect(runWave).not.toHaveBeenCalled();
    const gates = await listOpsGates(repoRoot);
    expect(gates.find((g) => g.id === low.id)?.consumedAt).toBeUndefined();
    expect(gates.some((g) => g.status === "pending" && g.level === "L4")).toBe(true);
  });

  it("L0 杠杆（recipe 缺省定级）不开门直接跑，wave 与台账记 level=L0", async () => {
    const { deps: d, runWave, appended } = deps(loop({ nextLever: { lever: "crawl", target: "https://x.example/" } }));
    const r = await runLoopWave("lvl-loop", d);
    expect(r.gated).toBe(false);
    expect(runWave).toHaveBeenCalledTimes(1);
    expect(appended[0]?.level).toBe("L0");
    expect(await listOpsGates(repoRoot)).toHaveLength(0);
  });
});