import { describe, expect, test } from "vitest";
import {
  flowKind, flowSaving, aggregateSavings, savingsByMonth, HUMAN_EQUIV_MINUTES,
} from "../../src/metrics/time-saved.js";

// 真实 ms 时间戳:spec@0 → audit@1min → implement@2min → verify@5min(工作跨度 5min)
const devHistory = [
  { stage: "spec", at: 0 },
  { stage: "audit", at: 1 * 60000 },
  { stage: "implement", at: 2 * 60000 },
  { stage: "verify", at: 5 * 60000 },
];

describe("time-saved v3a: loop 成本=工作阶段跨度 + 分类", () => {
  test("dev 流(history 含 implement)+verified → 净省 = 估时 − 工作跨度", () => {
    const f = { status: "verified", requirement: "加个小工具函数", startedAt: 0, updatedAt: 5 * 60000, history: devHistory };
    const s = flowSaving(f);
    expect(s.kind).toBe("dev");
    expect(s.loopActualMin).toBe(5);
    expect(s.netSavedMin).toBe(HUMAN_EQUIV_MINUTES.simple - 5);
  });

  test("loop 成本排除合并门等待:updatedAt 被 gate-cleared 撑到 3 小时,loop 仍只算工作跨度 5min", () => {
    const f = {
      status: "verified", requirement: "真功能", startedAt: 0, updatedAt: 3 * 3600000,
      history: [...devHistory, { stage: "gate-cleared", at: 3 * 3600000 }],
    };
    expect(flowSaving(f).loopActualMin).toBe(5);
  });

  test("history 时间戳不足 → 回退墙钟", () => {
    const f = { status: "verified", requirement: "x", startedAt: 0, updatedAt: 4 * 60000, history: [{ stage: "implement" }] };
    expect(flowSaving(f).loopActualMin).toBe(4);
  });

  test("data-ops 流(history 无 implement,如品类名 SPARK_PLUG)→ 净省 0", () => {
    const f = { status: "verified", requirement: "SPARK_PLUG", history: [{ stage: "spec", at: 0 }] };
    expect(flowKind(f)).toBe("data-ops");
    expect(flowSaving(f).netSavedMin).toBe(0);
  });

  test("maintenance 流(跑过 implement 但守护回灌)→ 不计净省", () => {
    const f = { status: "verified", requirement: "修复守护扫描发现的问题（lint/warn）：x.ts", history: devHistory };
    expect(flowKind(f)).toBe("maintenance");
    expect(flowSaving(f).netSavedMin).toBe(0);
  });

  test("loop 跨度超过人工估时 → 净省为负（不再有下限）", () => {
    const f = { status: "verified", requirement: "小改", history: [{ stage: "spec", at: 0 }, { stage: "implement", at: 60000 }, { stage: "verify", at: 999 * 60000 }] };
    expect(flowSaving(f).netSavedMin).toBe(HUMAN_EQUIV_MINUTES.simple - 999);
  });

  test("aggregateSavings 分类计数,只 dev+verified 进净省", () => {
    const flows = [
      { status: "verified", requirement: "真功能", history: devHistory },
      { status: "verified", requirement: "SPARK_PLUG", history: [{ stage: "spec", at: 0 }] },
      { status: "verified", requirement: "修复守护扫描发现的问题（lint/warn）：y.ts", history: devHistory },
      { status: "rolled-back", requirement: "废流", history: devHistory },
    ];
    const r = aggregateSavings(flows);
    expect(r.devFlows).toBe(2);
    expect(r.dataOpsFlows).toBe(1);
    expect(r.maintenanceFlows).toBe(1);
    expect(r.verifiedDevFlows).toBe(1);
    expect(r.netSavedHours).toBeCloseTo((HUMAN_EQUIV_MINUTES.simple - 5) / 60, 1);
  });

  test("savingsByMonth: 按 updatedAt 的 UTC YYYY-MM 分桶", () => {
    const jun = Date.UTC(2026, 5, 15);
    const may = Date.UTC(2026, 4, 10);
    const flows = [
      { status: "verified", requirement: "六月功能", updatedAt: jun, history: devHistory },
      { status: "verified", requirement: "五月功能", updatedAt: may, history: devHistory },
    ];
    const by = savingsByMonth(flows);
    expect(Object.keys(by).sort()).toEqual(["2026-05", "2026-06"]);
    expect(by["2026-06"].verifiedDevFlows).toBe(1);
  });
});