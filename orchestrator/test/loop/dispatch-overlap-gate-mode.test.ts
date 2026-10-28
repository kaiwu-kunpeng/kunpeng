import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OVERLAP_GATE,
  OVERLAP_STRICT_EXIT_CODE,
  overlapGateMode,
  precheckDispatchOverlap,
  type RunningFlowSource,
} from "../../src/loop/dispatch-overlap.js";
import {
  formatObserveWarn,
  gateObservationsPath,
  gatesConfigPath,
  summarizeGateObservations,
  type GateObservation,
} from "../../src/runtime/gate-mode.js";

// 派流重叠预检并入统一闸门模式:严格与否由 gates.json / env 的 gate 模式决定,KUNPENG_OVERLAP_STRICT=1 仅作最高优先级兼容开关;
// 每次预检(有无重叠都)记一行观察账本,便于先看误报率再决定升 block。
// 本文件不依赖 git:在跑流都带 predictedFiles,不会走 git diff 分支;repoRoot 只是账本/配置落点。

const tracker: RunningFlowSource = {
  list: async () => [
    { flowId: "other", status: "running", agentActive: false, predictedFiles: ["orchestrator/src/loop/a.ts", "orchestrator/src/loop/b.ts"] },
    { flowId: "self", status: "running", agentActive: false, predictedFiles: ["orchestrator/src/loop/a.ts"] },
  ],
};

const HIT = "改 orchestrator/src/loop/a.ts";
const MISS = "改 orchestrator/src/loop/z.ts";

function readLedger(repo: string): GateObservation[] {
  const path = gateObservationsPath(repo);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GateObservation);
}

function writeGates(stateDir: string, config: Record<string, string>): void {
  writeFileSync(gatesConfigPath(stateDir), JSON.stringify(config));
}

let repo: string;
let stateDir: string;
let lines: string[];
let exits: number[];
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-overlap-gate-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-overlap-gate-state-"));
  lines = [];
  exits = [];
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

const run = (requirement: string, extra: { env?: NodeJS.ProcessEnv; now?: () => number } = {}) =>
  precheckDispatchOverlap({
    flowId: "self",
    requirement,
    tracker,
    repoRoot: repo,
    env: { KUNPENG_STATE: stateDir, ...(extra.env ?? {}) },
    ...(extra.now ? { now: extra.now } : {}),
    log: (l) => lines.push(l),
    exit: (c) => exits.push(c),
  });

describe("overlapGateMode:dispatch-overlap 的默认是 observe,显式配置才走 gate-mode 三级优先级(作者锁定)", () => {
  test("无 env 无 gates.json → observe(不是 gate-mode 的全局默认 block)", () => {
    expect(OVERLAP_GATE).toBe("dispatch-overlap");
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir })).toBe("observe");
    expect(overlapGateMode(undefined, { KUNPENG_STATE: stateDir })).toBe("observe");
  });

  test("gates.json 显式 block → block;非法值视为未设 → observe;其它 gate 的配置不串味", () => {
    writeGates(stateDir, { "dispatch-overlap": "block" });
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir })).toBe("block");
    writeGates(stateDir, { "dispatch-overlap": "maybe" });
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir })).toBe("observe");
    writeGates(stateDir, { scope: "block", audit: "block" });
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir })).toBe("observe");
  });

  test("env KUNPENG_GATE_MODE_DISPATCH_OVERLAP 压过 gates.json(两个方向都锁);损坏的 gates.json 只 warn 不抛", () => {
    writeGates(stateDir, { "dispatch-overlap": "observe" });
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir, KUNPENG_GATE_MODE_DISPATCH_OVERLAP: "block" })).toBe("block");
    writeGates(stateDir, { "dispatch-overlap": "block" });
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir, KUNPENG_GATE_MODE_DISPATCH_OVERLAP: "observe" })).toBe("observe");
    writeFileSync(gatesConfigPath(stateDir), "{ not json");
    const warns: string[] = [];
    expect(overlapGateMode(repo, { KUNPENG_STATE: stateDir }, (m) => warns.push(m))).toBe("observe");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("gates.json");
  });
});

describe("precheckDispatchOverlap 并入闸门模式 + 观察账本(作者锁定)", () => {
  test("默认无配置:有重叠 observe 只告警继续,无重叠也记账 → 账本两行(分母 2,分子 1)", async () => {
    const hit = await run(HIT, { now: () => 1_700_000_000_000 });
    expect(hit.refused).toBe(false);
    expect(hit.mode).toBe("observe");
    expect(hit.overlaps).toEqual([{ flowId: "other", files: ["orchestrator/src/loop/a.ts"] }]);
    expect(exits).toEqual([]);
    expect(lines).toContain("[派流预检] 与在跑流 other 撞文件: orchestrator/src/loop/a.ts");
    expect(lines).toContain(formatObserveWarn("dispatch-overlap", "other: orchestrator/src/loop/a.ts"));
    expect(lines.some((l) => l.includes("KUNPENG_GATE_MODE_DISPATCH_OVERLAP=block"))).toBe(true);
    expect(lines.some((l) => l.includes("KUNPENG_OVERLAP_STRICT=1 可改为拒派"))).toBe(false);

    const miss = await run(MISS, { now: () => 1_700_000_000_001 });
    expect(miss.refused).toBe(false);
    expect(miss.overlaps).toEqual([]);
    expect(exits).toEqual([]);

    const ledger = readLedger(repo);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toEqual({
      gate: "dispatch-overlap",
      flowId: "self",
      wouldBlock: true,
      reason: "other: orchestrator/src/loop/a.ts",
      at: 1_700_000_000_000,
      mode: "observe",
    });
    expect(ledger[1]).toMatchObject({ gate: "dispatch-overlap", flowId: "self", wouldBlock: false, at: 1_700_000_000_001, mode: "observe" });
    expect(ledger[1]!.reason).toContain("无重叠");
    expect(summarizeGateObservations(readFileSync(gateObservationsPath(repo), "utf8").split("\n")))
      .toEqual({ "dispatch-overlap": { total: 2, wouldBlock: 1 } });
  });

  test("多条在跑流撞文件时 reason 用 '; ' 连接,每条 '<flowId>: a, b'", async () => {
    const multi: RunningFlowSource = {
      list: async () => [
        { flowId: "f1", status: "running", agentActive: false, predictedFiles: ["orchestrator/src/loop/a.ts", "orchestrator/src/loop/b.ts"] },
        { flowId: "f2", status: "running", agentActive: false, predictedFiles: ["orchestrator/src/loop/b.ts"] },
      ],
    };
    await precheckDispatchOverlap({
      flowId: "self",
      requirement: "改 orchestrator/src/loop/a.ts 与 orchestrator/src/loop/b.ts",
      tracker: multi,
      repoRoot: repo,
      env: { KUNPENG_STATE: stateDir },
      log: (l) => lines.push(l),
      exit: (c) => exits.push(c),
    });
    expect(readLedger(repo)[0]!.reason).toBe("f1: orchestrator/src/loop/a.ts, orchestrator/src/loop/b.ts; f2: orchestrator/src/loop/b.ts");
  });

  test("gates.json 写 dispatch-overlap: block → exit 4 拒派,账本 mode=block;无重叠时 block 模式也不拒", async () => {
    writeGates(stateDir, { "dispatch-overlap": "block" });
    const hit = await run(HIT);
    expect(hit.refused).toBe(true);
    expect(hit.mode).toBe("block");
    expect(exits).toEqual([OVERLAP_STRICT_EXIT_CODE]);
    expect(OVERLAP_STRICT_EXIT_CODE).toBe(4);
    expect(lines.some((l) => l.includes("block") && l.includes("拒派"))).toBe(true);
    expect(lines.some((l) => l.includes("observe 模式"))).toBe(false);

    exits.length = 0;
    const miss = await run(MISS);
    expect(miss.refused).toBe(false);
    expect(exits).toEqual([]);

    const ledger = readLedger(repo);
    expect(ledger.map((r) => [r.wouldBlock, r.mode])).toEqual([[true, "block"], [false, "block"]]);
  });

  test("env KUNPENG_GATE_MODE_DISPATCH_OVERLAP=block 生效(无 gates.json 也拒派);=observe 压过 gates.json 的 block", async () => {
    const byEnv = await run(HIT, { env: { KUNPENG_GATE_MODE_DISPATCH_OVERLAP: "block" } });
    expect(byEnv.refused).toBe(true);
    expect(exits).toEqual([4]);

    exits.length = 0;
    writeGates(stateDir, { "dispatch-overlap": "block" });
    const relaxed = await run(HIT, { env: { KUNPENG_GATE_MODE_DISPATCH_OVERLAP: "observe" } });
    expect(relaxed.refused).toBe(false);
    expect(relaxed.mode).toBe("observe");
    expect(exits).toEqual([]);
  });

  test("KUNPENG_OVERLAP_STRICT=1 是最高优先级兼容开关:压过 gates.json 与 env 的 observe;账本仍按实际模式记 observe", async () => {
    writeGates(stateDir, { "dispatch-overlap": "observe" });
    const strict = await run(HIT, { env: { KUNPENG_STATE: stateDir, KUNPENG_OVERLAP_STRICT: "1", KUNPENG_GATE_MODE_DISPATCH_OVERLAP: "observe" } });
    expect(strict.refused).toBe(true);
    expect(strict.mode).toBe("observe");
    expect(exits).toEqual([4]);
    expect(lines.some((l) => l.includes("KUNPENG_OVERLAP_STRICT=1") && l.includes("拒派"))).toBe(true);
    expect(readLedger(repo)[0]).toMatchObject({ wouldBlock: true, mode: "observe" });
    // 显式 strict: false 仍能关掉兼容开关(deps 优先于 env)
    exits.length = 0;
    const off = await precheckDispatchOverlap({
      flowId: "self", requirement: HIT, tracker, repoRoot: repo,
      env: { KUNPENG_STATE: stateDir, KUNPENG_OVERLAP_STRICT: "1" }, strict: false,
      log: (l) => lines.push(l), exit: (c) => exits.push(c),
    });
    expect(off.refused).toBe(false);
    expect(exits).toEqual([]);
  });

  test("账本写不进去(repoRoot 下 .kunpeng 是文件)只 warn 不抛,预检结论不变", async () => {
    writeFileSync(join(repo, ".kunpeng"), "not a dir");
    const hit = await run(HIT);
    expect(hit.refused).toBe(false);
    expect(lines.some((l) => l.includes("观察账本写入失败"))).toBe(true);
  });
});