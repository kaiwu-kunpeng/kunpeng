import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectAlerts, loadLedger, loopYieldPath, STARVED_THRESHOLD, type LoopRound } from "../../src/metrics/loop-yield.js";
import { recordAndWarn } from "../../src/metrics/loop-yield-record.js";

const rounds = (specs: Array<Partial<LoopRound>>): LoopRound[] =>
  specs.map((s, i) => ({ loop: "autopilot", project: "p", input: 0, yield: 0, at: i + 1, ...s }));

describe("饿死 vs 闲置（作者锁定）", () => {
  test("上游明确没活（upstream=0）连续多轮 → 不报饿死", () => {
    const ledger = { rounds: rounds(Array.from({ length: STARVED_THRESHOLD + 5 }, () => ({ upstream: 0 }))) };
    expect(detectAlerts(ledger)).toEqual([]);
  });

  test("上游有活（upstream>0）输入却连续为 0 → 报饿死，since 为段首", () => {
    const ledger = { rounds: rounds(Array.from({ length: STARVED_THRESHOLD }, () => ({ upstream: 3 }))) };
    expect(detectAlerts(ledger)).toEqual([{ loop: "autopilot", project: "p", kind: "starved", streak: STARVED_THRESHOLD, since: 1 }]);
  });

  test("闲置轮打断饿死段：末尾的闲置轮让前面的饿死段不再算", () => {
    const specs = [
      ...Array.from({ length: STARVED_THRESHOLD }, () => ({ upstream: 2 })),
      { upstream: 0 },
    ];
    expect(detectAlerts({ rounds: rounds(specs) })).toEqual([]);
  });

  test("不带 upstream 的老口径保持原样（兼容既有调用方）", () => {
    const ledger = { rounds: rounds(Array.from({ length: STARVED_THRESHOLD }, () => ({}))) };
    expect(detectAlerts(ledger).map((a) => a.kind)).toEqual(["starved"]);
  });

  test("空转（有输入无产出）不受 upstream 影响", () => {
    const ledger = { rounds: rounds([{ input: 2, upstream: 0 }, { input: 2, upstream: 0 }, { input: 2, upstream: 0 }]) };
    expect(detectAlerts(ledger).map((a) => a.kind)).toEqual(["stalled"]);
  });
});

describe("台账端到端（作者锁定）", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-starved-")); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("recordAndWarn 记下 upstream：闲置项目连跑不告警，上游有活才告警", async () => {
    let last: unknown = null;
    for (let i = 0; i < STARVED_THRESHOLD + 2; i += 1) {
      last = await recordAndWarn(repo, { loop: "autopilot", project: "idle", input: 0, yield: 0, upstream: 0 });
    }
    expect(last).toEqual([]);
    for (let i = 0; i < STARVED_THRESHOLD; i += 1) {
      last = await recordAndWarn(repo, { loop: "flywheel", project: "busy", input: 0, yield: 0, upstream: 4 });
    }
    expect((last as Array<{ kind: string }>).map((a) => a.kind)).toEqual(["starved"]);
    const saved = JSON.parse(readFileSync(loopYieldPath(repo), "utf8")) as { rounds: LoopRound[] };
    expect(saved.rounds.at(-1)?.upstream).toBe(4);
  });

  test("upstream 不是数字 → 与其它坏字段一样整本台账按坏数据处理（沿用既有校验语义）", async () => {
    mkdirSync(join(loopYieldPath(repo), ".."), { recursive: true });
    writeFileSync(loopYieldPath(repo), JSON.stringify({ rounds: [
      { loop: "a", project: "p", input: 0, yield: 0, at: 1, upstream: "many" },
      { loop: "a", project: "p", input: 0, yield: 0, at: 2, upstream: 1 },
    ] }));
    expect((await loadLedger(repo)).rounds).toEqual([]);
    writeFileSync(loopYieldPath(repo), JSON.stringify({ rounds: [{ loop: "a", project: "p", input: 0, yield: 0, at: 2, upstream: 1 }] }));
    expect((await loadLedger(repo)).rounds.map((r) => r.upstream)).toEqual([1]);
  });
});

describe("调用方接线（作者锁定，源码形状）", () => {
  test("autopilot 两处记账都声明 upstream: 0；flywheel 用 backlog 待办数", () => {
    const core = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    const autopilotBlocks = core.split('loop: "autopilot"').slice(1).map((s) => s.slice(0, 400));
    expect(autopilotBlocks).toHaveLength(2);
    for (const block of autopilotBlocks) expect(block).toContain("upstream: 0");
    const fly = readFileSync(new URL("../../src/cli-commands/flywheel-eval.ts", import.meta.url), "utf8");
    expect(fly).toContain("upstream: report.scanned.pending");
  });
});