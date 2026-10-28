import { describe, it, expect } from "vitest";
import {
  computeTokenCoverage,
  excludeAggregates,
  isAggregateFlowId,
  summarizeStageTokens,
  type FlowTokenSample,
} from "../../src/objects/flow-metrics.js";

describe("isAggregateFlowId 对脏输入健壮", () => {
  it("undefined / null 返回 false 且不抛", () => {
    expect(isAggregateFlowId(undefined)).toBe(false);
    expect(isAggregateFlowId(null)).toBe(false);
  });

  it("非字符串返回 false 且不抛", () => {
    expect(isAggregateFlowId(42)).toBe(false);
    expect(isAggregateFlowId({})).toBe(false);
    expect(isAggregateFlowId([])).toBe(false);
  });

  it("空串返回 false", () => {
    expect(isAggregateFlowId("")).toBe(false);
  });

  it("正常判定不变", () => {
    expect(isAggregateFlowId("plan-a")).toBe(true);
    expect(isAggregateFlowId("igate-b")).toBe(true);
    expect(isAggregateFlowId("real-0-0")).toBe(false);
  });
});

describe("excludeAggregates 吃真实的 .kunpeng/state 混合形状", () => {
  // 真实形状：maintenance-ledger.json 是数组；两个 baseline 是没有 flowId 的对象
  const real = [
    { flowId: "plan-mt1", tokensUsed: 0 },
    { flowId: "igate-base-x" },
    { netSavedHours: 285.2, verifiedDevFlows: 204 },
    { key: "autonomy", label: "自主度", value: 0.99 },
    [{ id: "mnt-1", at: "2026-07-11", what: "maintain 自动巡检" }],
    { flowId: "u4-1-real-0-0", tokensUsed: 100, stageTokens: { spec: 40, implement: 60 } },
    { flowId: "u3-2-real-0-0", tokensUsed: 300, stageTokens: { implement: 300 } },
  ] as unknown as FlowTokenSample[];

  it("只留下两条真实流，不抛异常", () => {
    const kept = excludeAggregates(real);
    expect(kept.map((s) => s.flowId)).toEqual(["u4-1-real-0-0", "u3-2-real-0-0"]);
  });

  it("剔除后算覆盖率与阶段汇总都正常", () => {
    const kept = excludeAggregates(real);
    expect(computeTokenCoverage(kept)).toEqual({ total: 2, withTokens: 2, coverage: 1 });
    expect(summarizeStageTokens(kept)).toEqual({ spec: 40, implement: 360 });
  });

  it("不修改入参数组", () => {
    const before = real.length;
    excludeAggregates(real);
    expect(real.length).toBe(before);
  });

  it("全是非流记录时返回空数组", () => {
    const junk = [{ a: 1 }, { b: 2 }, []] as unknown as FlowTokenSample[];
    expect(excludeAggregates(junk)).toEqual([]);
  });
});