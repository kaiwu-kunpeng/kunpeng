import { describe, it, expect } from "vitest";
import {
  computeTokenCoverage,
  summarizeStageTokens,
  topFlowsByTokens,
  type FlowTokenSample,
} from "../../src/objects/flow-metrics.js";

const samples: FlowTokenSample[] = [
  { flowId: "a", tokensUsed: 100, stageTokens: { spec: 40, implement: 60 } },
  { flowId: "b", tokensUsed: 300, stageTokens: { implement: 300 } },
  { flowId: "c" },
  { flowId: "d", tokensUsed: 0 },
];

describe("computeTokenCoverage", () => {
  it("只把有限正数算进覆盖", () => {
    expect(computeTokenCoverage(samples)).toEqual({
      total: 4,
      withTokens: 2,
      coverage: 0.5,
    });
  });

  it("空数组不产生 NaN", () => {
    expect(computeTokenCoverage([])).toEqual({ total: 0, withTokens: 0, coverage: 0 });
  });

  it("负数、NaN、Infinity 都不算", () => {
    const bad: FlowTokenSample[] = [
      { flowId: "x", tokensUsed: -5 },
      { flowId: "y", tokensUsed: Number.NaN },
      { flowId: "z", tokensUsed: Number.POSITIVE_INFINITY },
    ];
    expect(computeTokenCoverage(bad)).toEqual({ total: 3, withTokens: 0, coverage: 0 });
  });

  it("全部有记账时覆盖率为 1", () => {
    expect(computeTokenCoverage([{ flowId: "a", tokensUsed: 1 }]).coverage).toBe(1);
  });
});

describe("summarizeStageTokens", () => {
  it("跨流按阶段名相加", () => {
    expect(summarizeStageTokens(samples)).toEqual({ spec: 40, implement: 360 });
  });

  it("没有 stageTokens 时返回空对象", () => {
    expect(summarizeStageTokens([{ flowId: "a", tokensUsed: 5 }])).toEqual({});
  });

  it("非法值被忽略但合法阶段照常累加", () => {
    const mixed: FlowTokenSample[] = [
      { flowId: "a", stageTokens: { spec: 10, bad: Number.NaN } },
      { flowId: "b", stageTokens: { spec: 5, worse: -3 } },
    ];
    expect(summarizeStageTokens(mixed)).toEqual({ spec: 15 });
  });

  it("空输入返回空对象", () => {
    expect(summarizeStageTokens([])).toEqual({});
  });
});

describe("topFlowsByTokens", () => {
  it("按 token 降序取前 N", () => {
    expect(topFlowsByTokens(samples, 2).map((s) => s.flowId)).toEqual(["b", "a"]);
  });

  it("limit 大于可用数时只返回有记账的那些", () => {
    expect(topFlowsByTokens(samples, 99).map((s) => s.flowId)).toEqual(["b", "a"]);
  });

  it("limit 非正时返回空数组", () => {
    expect(topFlowsByTokens(samples, 0)).toEqual([]);
    expect(topFlowsByTokens(samples, -1)).toEqual([]);
  });

  it("不得修改入参数组的顺序", () => {
    const before = samples.map((s) => s.flowId);
    topFlowsByTokens(samples, 2);
    expect(samples.map((s) => s.flowId)).toEqual(before);
  });
});