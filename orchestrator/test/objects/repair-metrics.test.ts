import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderRepairAttemptReport,
  summarizeRepairAttempts,
  type RepairAttemptSample,
} from "../../src/objects/repair-metrics.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { parseCostReportArgs } from "../../src/cli-commands/reports.js";

function sample(status: string, repairAttempts: number, tokens: Record<string, number>): RepairAttemptSample {
  return { status, repairAttempts, repairAttemptTokens: tokens };
}

describe("summarizeRepairAttempts", () => {
  it("按第几次重试分列流数与 token", () => {
    const rows = summarizeRepairAttempts([
      sample("verified", 1, { "1": 100 }),
      sample("verified", 2, { "1": 200, "2": 300 }),
      sample("rolled-back", 2, { "1": 50, "2": 60 }),
    ]);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);
    // 第 1 次：三条流都发生过
    expect(rows[0].flows).toBe(3);
    expect(rows[0].tokens).toBe(350);
    // 第 2 次：两条流发生过
    expect(rows[1].flows).toBe(2);
    expect(rows[1].tokens).toBe(360);
  });

  it("recovered 只算 verified 且第 k 次是最后一次的流", () => {
    const rows = summarizeRepairAttempts([
      sample("verified", 1, { "1": 10 }),      // 第1次救回
      sample("verified", 2, { "1": 10, "2": 10 }), // 第2次才救回
      sample("rolled-back", 2, { "1": 10, "2": 10 }), // 没救回
    ]);
    expect(rows[0].recovered).toBe(1);   // 只有第一条
    expect(rows[1].recovered).toBe(1);   // 只有第二条
    expect(rows[0].flows).toBe(3);
    expect(rows[1].flows).toBe(2);
  });

  it("recoveryRate 正确且空流时不产生 NaN", () => {
    const rows = summarizeRepairAttempts([
      sample("verified", 1, { "1": 10 }),
      sample("rolled-back", 1, { "1": 10 }),
    ]);
    expect(rows[0].recoveryRate).toBeCloseTo(0.5, 6);
    for (const r of rows) expect(Number.isNaN(r.recoveryRate)).toBe(false);
  });

  it("flows 为 0 的次序不出现在结果里", () => {
    const rows = summarizeRepairAttempts([sample("verified", 1, { "1": 10 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt).toBe(1);
  });

  it("非有限 token 被忽略而不污染合计", () => {
    const rows = summarizeRepairAttempts([
      sample("verified", 1, { "1": 100 }),
      sample("verified", 1, { "1": Number.NaN }),
      sample("verified", 1, { "1": Number.POSITIVE_INFINITY }),
    ]);
    expect(rows[0].tokens).toBe(100);
    expect(Number.isFinite(rows[0].tokens)).toBe(true);
  });

  it("空输入返回空数组", () => {
    expect(summarizeRepairAttempts([])).toEqual([]);
  });

  it("没有 repairAttempts 的流不计入任何次序", () => {
    expect(summarizeRepairAttempts([{ status: "verified" }])).toEqual([]);
  });
});

describe("renderRepairAttemptReport", () => {
  it("输出含次序、流数与百分号", () => {
    const out = renderRepairAttemptReport(summarizeRepairAttempts([
      sample("verified", 1, { "1": 100 }),
      sample("rolled-back", 1, { "1": 50 }),
    ]));
    expect(out).toContain("1");
    expect(out).toContain("%");
  });

  it("空 rows 时含「暂无重试数据」", () => {
    expect(renderRepairAttemptReport([])).toContain("暂无重试数据");
  });
});

describe("FlowTracker.recordRepairAttempt", () => {
  it("累加同一次序的 token，且 repairAttempts 取最大值而非自增", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-repair-attr-"));
    try {
      const t = new FlowTracker(dir);
      await t.start("f1", "需求");
      await t.recordRepairAttempt("f1", 1, 100);
      await t.recordRepairAttempt("f1", 1, 50);
      const s1 = await t.read("f1");
      expect(s1?.repairAttempts).toBe(1);
      expect(s1?.repairAttemptTokens?.["1"]).toBe(150);

      await t.recordRepairAttempt("f1", 2, 30);
      const s2 = await t.read("f1");
      expect(s2?.repairAttempts).toBe(2);
      expect(s2?.repairAttemptTokens?.["2"]).toBe(30);
      // 再记一次更小的次序，不得把 repairAttempts 拉低或自增
      await t.recordRepairAttempt("f1", 1, 5);
      expect((await t.read("f1"))?.repairAttempts).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tokens<=0 时不写 token 键但仍更新 repairAttempts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-repair-attr0-"));
    try {
      const t = new FlowTracker(dir);
      await t.start("f2", "需求");
      await t.recordRepairAttempt("f2", 1, 0);
      const s = await t.read("f2");
      expect(s?.repairAttempts).toBe(1);
      expect(s?.repairAttemptTokens?.["1"]).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("流不存在时静默返回、不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-repair-attr-miss-"));
    try {
      const t = new FlowTracker(dir);
      await expect(t.recordRepairAttempt("nope", 1, 10)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归护栏：stageTokens.repair 仍照旧累加，且等于逐次之和", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-repair-attr-reg-"));
    try {
      const t = new FlowTracker(dir);
      await t.start("f3", "需求");
      await t.addStageTokens("f3", "repair", 100);
      await t.recordRepairAttempt("f3", 1, 100);
      await t.addStageTokens("f3", "repair", 40);
      await t.recordRepairAttempt("f3", 2, 40);
      const s = await t.read("f3");
      expect(s?.stageTokens?.repair).toBe(140);
      const perAttempt = Object.values(s?.repairAttemptTokens ?? {}).reduce((a, b) => a + b, 0);
      expect(perAttempt).toBe(s?.stageTokens?.repair);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCostReportArgs 认得 --by-attempt", () => {
  it("解析 --by-attempt", () => {
    const r = parseCostReportArgs(["--by-attempt"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.byAttempt).toBe(true);
  });

  it("仍认得 --by-stage 与 --json 与 --month", () => {
    const a = parseCostReportArgs(["--by-stage"]);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.byStage).toBe(true);
    const b = parseCostReportArgs(["--json"]);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.json).toBe(true);
    const c = parseCostReportArgs(["--month", "2026-08"]);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.month).toBe("2026-08");
  });

  it("未知参数仍报错", () => {
    expect(parseCostReportArgs(["--nope"]).ok).toBe(false);
  });
});