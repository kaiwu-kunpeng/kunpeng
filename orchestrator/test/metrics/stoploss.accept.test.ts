import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildNorthstar, formatNorthstarReport, judgeStopLoss, type NorthstarFlow } from "../../src/metrics/northstar.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 11, 15, 12);
const impl = [{ stage: "spec" }, { stage: "implement" }, { stage: "verify" }];

describe("机器来源列", () => {
  const flows: NorthstarFlow[] = [
    { flowId: "m1", startedBy: { by: "machine" }, startedAt: NOW - 50 * DAY, history: impl },
    { flowId: "m-trivial", startedBy: { by: "machine" }, startedAt: NOW - 50 * DAY, history: [{ stage: "spec" }, { stage: "verify" }] },
    { flowId: "m-rev", startedBy: { by: "machine" }, startedAt: NOW - 50 * DAY, history: impl },
    { flowId: "a1", startedBy: { by: "agent" }, startedAt: NOW - 50 * DAY, history: impl },
    { flowId: "plan-9", history: [] },
    { flowId: "child", planId: "plan-9", startedBy: { by: "machine" }, startedAt: NOW - 50 * DAY, history: impl },
  ];
  const merges = ["m1", "m-trivial", "m-rev", "a1", "plan-9"].map((flowId) => ({ flowId, mergedAt: NOW - 3 * DAY }));
  const weeks = buildNorthstar(merges, ["m-rev"], flows, { now: NOW, weeks: 1 });

  it("只数 machine 发起 + implement + 未 revert；plan 子流来源算进 plan", () => {
    expect(weeks[0].machineOrigin).toBe(2);
  });

  it("每周行带机器来源", () => {
    expect(formatNorthstarReport(weeks)).toContain("机器来源 2");
  });
});

describe("judgeStopLoss", () => {
  const machine = (flowId: string, startedAt: number): NorthstarFlow => ({ flowId, startedBy: { by: "machine" }, startedAt, history: impl });

  it("无来源数据 → 观测 0 天、不触发", () => {
    expect(judgeStopLoss([{ flowId: "x", mergedAt: NOW - DAY }], [], [{ flowId: "x", history: impl }], { now: NOW })).toEqual({
      observedSince: null, observedDays: 0, machineOriginMerges: 0, triggered: false,
    });
  });

  it("观测满 42 天且不足 3 条 → 触发", () => {
    const flows = [machine("m1", NOW - 60 * DAY), machine("m2", NOW - 50 * DAY)];
    const merges = [{ flowId: "m1", mergedAt: NOW - 30 * DAY }, { flowId: "m2", mergedAt: NOW - 10 * DAY }];
    const s = judgeStopLoss(merges, [], flows, { now: NOW });
    expect(s.observedSince).toBe(NOW - 60 * DAY);
    expect(s.observedDays).toBe(60);
    expect(s.machineOriginMerges).toBe(2);
    expect(s.triggered).toBe(true);
  });

  it("满 3 条 → 不触发；窗口外的合入不算", () => {
    const flows = [machine("m1", NOW - 90 * DAY), machine("m2", NOW - 50 * DAY), machine("m3", NOW - 50 * DAY), machine("old", NOW - 90 * DAY)];
    const merges = [
      { flowId: "m1", mergedAt: NOW - 40 * DAY },
      { flowId: "m2", mergedAt: NOW - 20 * DAY },
      { flowId: "m3", mergedAt: NOW - 1 * DAY },
      { flowId: "old", mergedAt: NOW - 80 * DAY },
    ];
    const s = judgeStopLoss(merges, [], flows, { now: NOW });
    expect(s.machineOriginMerges).toBe(3);
    expect(s.triggered).toBe(false);
  });

  it("观测不满 42 天 → 不触发；窗口起点不早于观测起点", () => {
    const flows = [machine("m1", NOW - 10 * DAY), { flowId: "pre", history: impl } as NorthstarFlow];
    const s = judgeStopLoss([{ flowId: "m1", mergedAt: NOW - 2 * DAY }], [], flows, { now: NOW });
    expect(s.observedDays).toBe(10);
    expect(s.machineOriginMerges).toBe(1);
    expect(s.triggered).toBe(false);
  });

  it("revert 掉的不算；可调窗口与门槛", () => {
    const flows = [machine("m1", NOW - 20 * DAY)];
    const merges = [{ flowId: "m1", mergedAt: NOW - 5 * DAY }];
    expect(judgeStopLoss(merges, ["m1"], flows, { now: NOW, windowDays: 14, minMerges: 1 }).triggered).toBe(true);
    expect(judgeStopLoss(merges, [], flows, { now: NOW, windowDays: 14, minMerges: 1 }).triggered).toBe(false);
  });
});

describe("报告止损行", () => {
  const weeks = buildNorthstar([], [], [], { now: NOW, weeks: 1 });
  it("三种文案", () => {
    const fire = formatNorthstarReport(weeks, "k", { observedSince: NOW - 50 * DAY, observedDays: 50, machineOriginMerges: 1, triggered: true });
    expect(fire).toContain("机器环止损线：");
    expect(fire).toContain("近 42 天机器来源非琐碎合入 1 条");
    expect(fire).toContain("已观测 50 天");
    expect(fire).toContain("🛑 已触发：停止投入机器环，降为每月批跑");
    expect(formatNorthstarReport(weeks, "k", { observedSince: NOW - 5 * DAY, observedDays: 5, machineOriginMerges: 0, triggered: false })).toContain("观测未满 42 天，暂不判定");
    expect(formatNorthstarReport(weeks, "k", { observedSince: NOW - 50 * DAY, observedDays: 50, machineOriginMerges: 4, triggered: false })).toContain("未触发");
    expect(formatNorthstarReport(weeks, "k")).not.toContain("机器环止损线");
  });
  it("CLI 把 judgeStopLoss 的结果传进报告", () => {
    const src = readFileSync(new URL("../../src/cli-commands/reports.ts", import.meta.url), "utf8");
    expect(src).toContain("judgeStopLoss(");
  });
});