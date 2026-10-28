import { describe, it, expect } from "vitest";
import {
  rolledBackFlowIdsFromStates,
  buildEscapeRateFromLogs,
  formatEscapeRateReport,
} from "../../src/metrics/escape-rate-report.js";

describe("rolledBackFlowIdsFromStates", () => {
  it("只取 rolled-back 状态的 flowId，去重保序", () => {
    const states = [
      { flowId: "a", status: "verified" },
      { flowId: "b", status: "rolled-back" },
      { flowId: "c", status: "rolled-back" },
      { flowId: "b", status: "rolled-back" },
    ];
    expect(rolledBackFlowIdsFromStates(states)).toEqual(["b", "c"]);
  });

  it("无 rolled-back → 空数组", () => {
    expect(
      rolledBackFlowIdsFromStates([{ flowId: "a", status: "verified" }]),
    ).toEqual([]);
  });
});

describe("buildEscapeRateFromLogs", () => {
  const mergedLog = [
    "1782520687|Merge branch 'kp/a' into HEAD",
    "1782520042|Merge branch 'kp/b' into HEAD",
  ].join("\n");

  it("git-revert + rolled-back 两路都计入逃逸", () => {
    const er = buildEscapeRateFromLogs(
      mergedLog,
      'Revert "kp(a): verified"',
      ["b"],
    );
    expect(er.mergedCount).toBe(2);
    expect(er.escapedCount).toBe(2);
    expect(er.rate).toBe(1);
    expect(er.escapedFlowIds.sort()).toEqual(["a", "b"]);
  });

  it("无逃逸 → rate 0", () => {
    const er = buildEscapeRateFromLogs(mergedLog, "", []);
    expect(er.mergedCount).toBe(2);
    expect(er.escapedCount).toBe(0);
    expect(er.rate).toBe(0);
  });

  it("windowMs 给定 → 只算窗口内合并的", () => {
    // a 的 mergedAt=1782520687000；now 设在其后 1 小时，窗口 30 分钟 → 只 a 落窗外、全落窗外?
    const now = 1782520687000 + 60 * 60 * 1000; // a 之后 1 小时
    const er = buildEscapeRateFromLogs(mergedLog, "", [], {
      windowMs: 30 * 60 * 1000, // 30 分钟窗口
      now,
    });
    // a(687) 与 b(042) 都在 now-30min 之前 → 窗口内 0 条
    expect(er.mergedCount).toBe(0);
  });
});

describe("formatEscapeRateReport", () => {
  it("报告含逃逸率百分比/合并数/逃逸数/逃逸flowId/窗口label", () => {
    const out = formatEscapeRateReport(
      {
        mergedCount: 4,
        escapedCount: 1,
        rate: 0.25,
        escapedFlowIds: ["bad-flow"],
      },
      { windowLabel: "近7天" },
    );
    expect(out).toContain("近7天");
    expect(out).toContain("逃逸率");
    expect(out).toContain("25.0%");
    expect(out).toContain("4");
    expect(out).toContain("bad-flow");
  });

  it("零逃逸不报 flowId 行也能格式化", () => {
    const out = formatEscapeRateReport({
      mergedCount: 3,
      escapedCount: 0,
      rate: 0,
      escapedFlowIds: [],
    });
    expect(out).toContain("0.0%");
    expect(out).toContain("逃逸率");
  });
});