import { describe, expect, it } from "vitest";
import { buildF07Dashboard } from "../src/server/state.js";

const D = 24 * 3600 * 1000;

describe("F-07 仪表(作者验收)", () => {
  it("自动完成率/回滚率按 verified vs rolled-back 计算", () => {
    const now = 100 * D;
    const d = buildF07Dashboard(
      [
        { status: "verified", tokensUsed: 100, updatedAt: now - D },
        { status: "verified", tokensUsed: 100, updatedAt: now - D },
        { status: "verified", tokensUsed: 100, updatedAt: now - D },
        { status: "rolled-back", tokensUsed: 100, updatedAt: now - D },
        { status: "running", tokensUsed: 1, updatedAt: now - D },
      ],
      now,
    );
    expect(d.autoCompletionPct).toBe(75);
    expect(d.rollbackPct).toBe(25);
  });

  it("30天窗口与趋势判断", () => {
    const now = 100 * D;
    const d = buildF07Dashboard(
      [
        { status: "verified", tokensUsed: 1000, updatedAt: now - 5 * D },
        { status: "verified", tokensUsed: 2000, updatedAt: now - 45 * D },
      ],
      now,
    );
    expect(d.tokens30d).toBe(1000);
    expect(d.tokensPrev30d).toBe(2000);
    expect(d.costTrend).toBe("down");
  });

  it("空输入与脏数据不抛且归零", () => {
    const d = buildF07Dashboard([{ status: "verified", tokensUsed: Number.NaN }], 0);
    expect(d.autoCompletionPct).toBe(100);
    expect(d.tokens30d).toBe(0);
    const empty = buildF07Dashboard([], 1000);
    expect(empty.autoCompletionPct).toBe(0);
    expect(empty.costTrend).toBe("flat");
  });

  it("待批人工门计数", () => {
    const now = 10 * D;
    const d = buildF07Dashboard(
      [
        { status: "verified", humanGate: { gate: "合并主干" }, updatedAt: now },
        { status: "rolled-back", humanGate: { gate: "x" }, updatedAt: now },
      ],
      now,
    );
    expect(d.openHumanGates).toBe(1);
  });
});