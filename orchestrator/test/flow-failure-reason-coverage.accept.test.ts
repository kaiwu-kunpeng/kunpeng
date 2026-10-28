import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FlowTracker } from "../src/runtime/flowstate.js";
import { abandonFlow } from "../src/runtime/flow-abandon.js";
import { reconcileSupersededGhosts } from "../src/runtime/reconcile.js";
import { runLoopWave } from "../src/loop/driver.js";
import { recordLoopWave } from "../src/cli-commands/loop-core.js";
import type { LoopRecipe, WaveResult } from "../src/loop/recipe.js";
import type { LoopDef, Wave } from "../src/loop/types.js";

let dir: string;
let tick: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-fr-"));
  tick = 1_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tracker(): FlowTracker {
  return new FlowTracker(join(dir, "state"), () => tick++);
}

// —— 1. FlowTracker.finish 兜底链（本切片的地基，任何路径漏传都靠它兜） ——

test("finish(rolled-back): 显式 reason 优先", async () => {
  const t = tracker();
  await t.start("f1", "需求 1");
  await t.block("f1", "块级卡点");
  await t.finish("f1", "rolled-back", undefined, "显式原因");
  const s = await t.read("f1");
  expect(s?.failureReason).toBe("显式原因");
  expect(s?.blocker).toBeUndefined();
});

test("finish(rolled-back): 无显式 reason 时回落到 blocker", async () => {
  const t = tracker();
  await t.start("f2", "需求 2");
  await t.block("f2", "验收测试审计未通过: spec 未给出验收验证命令");
  await t.finish("f2", "rolled-back");
  const s = await t.read("f2");
  expect(s?.failureReason).toBe("验收测试审计未通过: spec 未给出验收验证命令");
  expect(s?.blocker).toBeUndefined();
});

test("finish(rolled-back): 无 reason 无 blocker 时回落到 humanGate.what", async () => {
  const t = tracker();
  await t.start("f3", "需求 3");
  await t.finish("f3", "rolled-back", { gate: "运营 loop 波前护栏", what: "[halt] 连败熔断" });
  const s = await t.read("f3");
  expect(s?.failureReason).toBe("[halt] 连败熔断");
});

test("finish(rolled-back): 三者全无则不写空原因", async () => {
  const t = tracker();
  await t.start("f4", "需求 4");
  await t.finish("f4", "rolled-back");
  const s = await t.read("f4");
  expect(s?.failureReason).toBeUndefined();
});

test("finish(rolled-back): 空白 reason 不覆盖 blocker", async () => {
  const t = tracker();
  await t.start("f5", "需求 5");
  await t.block("f5", "真实卡点");
  await t.finish("f5", "rolled-back", undefined, "   ");
  const s = await t.read("f5");
  expect(s?.failureReason).toBe("真实卡点");
});

test("finish(verified): 即便有 blocker 也绝不写 failureReason", async () => {
  const t = tracker();
  await t.start("f6", "需求 6");
  await t.block("f6", "一度卡住但最终通过");
  await t.finish("f6", "verified");
  const s = await t.read("f6");
  expect(s?.status).toBe("verified");
  expect(s?.failureReason).toBeUndefined();
  expect(s?.blocker).toBeUndefined();
});

// —— 2. abandonFlow / reconcileSupersededGhosts —— 

test("abandonFlow 落 [abandoned] 原因并保留放弃前卡点", async () => {
  const stateDir = join(dir, "state");
  const t = new FlowTracker(stateDir, () => tick++);
  await t.start("f-ab", "被放弃的流");
  await t.block("f-ab", "implement 阶段超时");
  const res = await abandonFlow(stateDir, "f-ab", () => tick++);
  expect(res.ok).toBe(true);
  const s = await t.read("f-ab");
  expect(s?.status).toBe("rolled-back");
  expect(s?.blocker).toBeUndefined();
  expect(s?.failureReason).toContain("[abandoned]");
  expect(s?.failureReason).toContain("implement 阶段超时");
});

test("abandonFlow 无 blocker 时仍落非空 [abandoned] 原因", async () => {
  const stateDir = join(dir, "state");
  const t = new FlowTracker(stateDir, () => tick++);
  await t.start("f-ab2", "被放弃的流 2");
  expect((await abandonFlow(stateDir, "f-ab2", () => tick++)).ok).toBe(true);
  const s = await t.read("f-ab2");
  expect(s?.failureReason).toContain("[abandoned]");
  expect(String(s?.failureReason).trim()).not.toBe("");
});

test("reconcileSupersededGhosts 退役崩溃流时落 [retired-superseded] 原因", async () => {
  const root = await repoRoot();
  const t = new FlowTracker(join(root, ".kunpeng", "state"), () => tick++);
  await t.start("f-ghost", "崩溃后被主干吸收的流");
  await t.markCrashed("f-ghost", "主人进程已崩溃（启动时判定）");
  const out = await reconcileSupersededGhosts(t, root, {
    hasBranch: async () => true,
    isSubsumed: async () => true,
  });
  expect(out.retired).toContain("f-ghost");
  const s = await t.read("f-ghost");
  expect(s?.status).toBe("rolled-back");
  expect(s?.blocker).toBeUndefined();
  expect(s?.failureReason).toContain("[retired-superseded]");
  expect(s?.failureReason).toContain("主人进程已崩溃");
});

// —— 3. loop 驱动三条路径 —— 

const RECIPE_ID = "fr-accept-recipe";

function loopDef(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "fr-loop",
    name: "FR Loop",
    projectId: "fr-project",
    recipe: RECIPE_ID,
    metric: { key: "m", label: "M", current: 10 },
    levers: [{ id: "ship", label: "Ship", status: "active" }],
    nextLever: { lever: "ship", target: "TARGET-A" },
    waves: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function fakeRecipe(result: WaveResult): LoopRecipe {
  return {
    id: RECIPE_ID,
    listLevers: (def) => def.levers,
    readMetric: async (def) => def.metric.current,
    runWave: vi.fn(async () => result),
  };
}

async function repoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kp-fr-repo-"));
  execFileSync("git", ["init", "--quiet", root]);
  await mkdir(join(root, ".kunpeng"), { recursive: true });
  return root;
}

test("runLoopWave 非自治门落 [loop-gate] 原因", async () => {
  const finish = vi.fn(async () => undefined);
  await runLoopWave("fr-loop", {
    repoRoot: await repoRoot(),
    store: { read: async () => loopDef({ autonomous: false }), appendWave: vi.fn() },
    tracker: { start: vi.fn(async () => undefined), finish },
    getRecipe: () => fakeRecipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }),
    env: {},
    now: () => 777,
  });
  expect(finish).toHaveBeenCalledWith(
    "loop-fr-loop-gate-777",
    "rolled-back",
    expect.objectContaining({ gate: "运营 loop 对外推送" }),
    expect.stringContaining("[loop-gate]"),
  );
});

test("runLoopWave 波前护栏拦截落 [loop-guard] 原因（含护栏 kind 与具体理由）", async () => {
  const finish = vi.fn(async () => undefined);
  const runWave = vi.fn();
  await runLoopWave("fr-loop", {
    repoRoot: await repoRoot(),
    store: { read: async () => loopDef({ autonomous: true }), appendWave: vi.fn() },
    tracker: { start: vi.fn(async () => undefined), finish },
    getRecipe: () => ({ ...fakeRecipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }), runWave }),
    guard: () => ({ allow: false, kind: "halt", reason: "连续无进展 3 次，达到熔断阈值 3" }),
    env: {},
    now: () => 888,
  });
  expect(runWave).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(
    "loop-fr-loop-guard-888",
    "rolled-back",
    expect.objectContaining({ gate: "运营 loop 波前护栏" }),
    expect.stringContaining("[loop-guard]"),
  );
  expect(finish).toHaveBeenCalledWith(
    "loop-fr-loop-guard-888",
    "rolled-back",
    expect.anything(),
    expect.stringContaining("连续无进展"),
  );
});

test("runLoopWave 未验证波落 [loop-wave-unverified] 原因，已验证波保持两参不落原因", async () => {
  const appended: Wave = {
    seq: 4, at: 1, lever: "ship", subject: "TARGET-A",
    metricDelta: 0, metricAfter: 10, verified: false, detail: "冒烟未通过",
  };
  const failFinish = vi.fn(async () => undefined);
  await runLoopWave("fr-loop", {
    repoRoot: await repoRoot(),
    store: { read: async () => loopDef({ autonomous: true }), appendWave: async () => appended },
    tracker: { start: vi.fn(async () => undefined), finish: failFinish },
    getRecipe: () => fakeRecipe({ metricBefore: 10, metricAfter: 10, metricDelta: 0, verified: false, detail: "冒烟未通过" }),
    resolveRepoPath: async () => "/fr/repo",
    learningStore: { append: vi.fn(async () => undefined) },
    guardDisabled: true,
    env: {},
    now: () => 999,
  });
  expect(failFinish).toHaveBeenCalledWith(
    "loop-fr-loop-w4",
    "rolled-back",
    undefined,
    expect.stringContaining("[loop-wave-unverified]"),
  );
  expect(failFinish).toHaveBeenCalledWith(
    "loop-fr-loop-w4",
    "rolled-back",
    undefined,
    expect.stringContaining("冒烟未通过"),
  );

  const okFinish = vi.fn(async () => undefined);
  await runLoopWave("fr-loop", {
    repoRoot: await repoRoot(),
    store: {
      read: async () => loopDef({ autonomous: true }),
      appendWave: async () => ({ ...appended, seq: 5, verified: true }),
    },
    tracker: { start: vi.fn(async () => undefined), finish: okFinish },
    getRecipe: () => fakeRecipe({ metricBefore: 10, metricAfter: 12, metricDelta: 2, verified: true }),
    resolveRepoPath: async () => "/fr/repo",
    learningStore: { append: vi.fn(async () => undefined) },
    guardDisabled: true,
    env: {},
    now: () => 1000,
  });
  // verified 分支必须保持两参调用形态（既有 driver.test.ts / recipe.test.ts 断言据此为绿）。
  expect(okFinish).toHaveBeenCalledWith("loop-fr-loop-w5", "verified");
});

test("recordLoopWave 未验证波落 [loop-wave-unverified] 原因，已验证波保持两参", async () => {
  const finish = vi.fn(async () => undefined);
  await recordLoopWave(
    { id: "fr-loop", lever: "ship", subject: "TARGET-A", delta: 0, after: 9, verified: false, detail: "部署未就绪" },
    { store: { appendWave: async () => ({ seq: 3, at: 999, lever: "ship", subject: "TARGET-A", metricDelta: 0, metricAfter: 9, verified: false }) },
      tracker: { start: vi.fn(async () => undefined), finish }, now: () => 999 },
  );
  expect(finish).toHaveBeenCalledWith(
    "loop-fr-loop-w3",
    "rolled-back",
    undefined,
    expect.stringContaining("[loop-wave-unverified]"),
  );

  const okFinish = vi.fn(async () => undefined);
  await recordLoopWave(
    { id: "fr-loop", lever: "ship", subject: "TARGET-A", delta: 1, after: 10, verified: true },
    { store: { appendWave: async () => ({ seq: 6, at: 999, lever: "ship", subject: "TARGET-A", metricDelta: 1, metricAfter: 10, verified: true }) },
      tracker: { start: vi.fn(async () => undefined), finish: okFinish }, now: () => 999 },
  );
  expect(okFinish).toHaveBeenCalledWith("loop-fr-loop-w6", "verified");
});

// —— 4. 端到端：真 FlowTracker 走完非自治门，盘上必须留下原因 —— 

test("端到端：非自治门用真 FlowTracker 落盘后 failureReason 非空", async () => {
  const root = await repoRoot();
  const res = await runLoopWave("fr-loop", {
    repoRoot: root,
    store: { read: async () => loopDef({ autonomous: false }), appendWave: vi.fn() },
    getRecipe: () => fakeRecipe({ metricBefore: 0, metricAfter: 0, metricDelta: 0, verified: true }),
    env: {},
    now: () => 424242,
  });
  expect(res.gated).toBe(true);
  const stateFile = join(root, ".kunpeng", "state", `${res.flowId}.json`);
  const raw = JSON.parse(await readFile(stateFile, "utf8")) as { status: string; failureReason?: string };
  expect(raw.status).toBe("rolled-back");
  expect(typeof raw.failureReason).toBe("string");
  expect(String(raw.failureReason).trim()).not.toBe("");
});