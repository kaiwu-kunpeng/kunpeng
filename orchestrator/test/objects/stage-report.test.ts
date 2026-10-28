import { describe, it, expect } from "vitest";
import {
  buildStageCostRows,
  renderStageCostReport,
} from "../../src/objects/stage-report.js";
import {
  excludeAggregates,
  isAggregateFlowId,
  type FlowTokenSample,
} from "../../src/objects/flow-metrics.js";
import { parseCostReportArgs } from "../../src/cli-commands/reports.js";

describe("isAggregateFlowId", () => {
  it("plan- 与 igate- 开头是聚合记录", () => {
    expect(isAggregateFlowId("plan-abc")).toBe(true);
    expect(isAggregateFlowId("igate-base-x")).toBe(true);
  });

  it("普通 flowId 与空串不是", () => {
    expect(isAggregateFlowId("u4-1-flow-token-0-0")).toBe(false);
    expect(isAggregateFlowId("")).toBe(false);
  });
});

describe("excludeAggregates", () => {
  const samples: FlowTokenSample[] = [
    { flowId: "plan-a", tokensUsed: 1 },
    { flowId: "real-a-0-0", tokensUsed: 2 },
    { flowId: "igate-b", tokensUsed: 3 },
    { flowId: "real-b-0-0" },
  ];

  it("只留下真实流", () => {
    expect(excludeAggregates(samples).map((s) => s.flowId)).toEqual(["real-a-0-0", "real-b-0-0"]);
  });

  it("不修改入参数组", () => {
    const before = samples.map((s) => s.flowId);
    excludeAggregates(samples);
    expect(samples.map((s) => s.flowId)).toEqual(before);
  });
});

describe("buildStageCostRows", () => {
  it("按 tokens 降序并算出占比", () => {
    const rows = buildStageCostRows({ spec: 100, implement: 300 });
    expect(rows.map((r) => r.stage)).toEqual(["implement", "spec"]);
    expect(rows[0].tokens).toBe(300);
    expect(rows[0].share).toBeCloseTo(0.75, 6);
    expect(rows[1].share).toBeCloseTo(0.25, 6);
  });

  it("空输入返回空数组", () => {
    expect(buildStageCostRows({})).toEqual([]);
  });

  it("非法值与非正数被忽略", () => {
    const rows = buildStageCostRows({ a: Number.NaN, b: -5, c: 0, d: 10 });
    expect(rows.map((r) => r.stage)).toEqual(["d"]);
    expect(rows[0].share).toBe(1);
  });

  it("全部非法时返回空数组且不产生 NaN", () => {
    const rows = buildStageCostRows({ a: Number.NaN, b: -1 });
    expect(rows).toEqual([]);
  });
});

describe("renderStageCostReport", () => {
  it("含阶段名、数字与百分号，并附覆盖率", () => {
    const out = renderStageCostReport(buildStageCostRows({ implement: 300, spec: 100 }), {
      total: 10,
      withTokens: 9,
      coverage: 0.9,
    });
    expect(out).toContain("implement");
    expect(out).toContain("spec");
    expect(out).toContain("%");
    expect(out).toContain("9");
  });

  it("空 rows 时给出明确提示", () => {
    const out = renderStageCostReport([], { total: 0, withTokens: 0, coverage: 0 });
    expect(out).toContain("暂无阶段数据");
  });
});

describe("parseCostReportArgs", () => {
  it("认得 --by-stage", () => {
    const r = parseCostReportArgs(["--by-stage"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.byStage).toBe(true);
  });

  it("不给时 byStage 为假", () => {
    const r = parseCostReportArgs([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.byStage).toBe(false);
  });

  it("仍认得 --json 与 --month", () => {
    const r = parseCostReportArgs(["--json", "--month", "2026-08", "--by-stage"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toBe(true);
      expect(r.month).toBe("2026-08");
      expect(r.byStage).toBe(true);
    }
  });

  it("未知参数仍报错", () => {
    expect(parseCostReportArgs(["--nope"]).ok).toBe(false);
  });
});