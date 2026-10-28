// orchestrator/test/product/velocity-source.test.ts —— 作者亲写,严禁改（框架写盘锁定）
import { describe, it, expect } from "vitest";
import { flowActualHours, velocitiesFromFlows } from "../../src/product/velocity-source.js";
import type { FlowState } from "../../src/runtime/flowstate.js";

const H = 3_600_000;
function flow(id: string, status: FlowState["status"], hours: number): FlowState {
  return {
    flowId: id, requirement: "r", stage: "done", status, agentActive: false,
    startedAt: 0, updatedAt: Math.round(hours * H), history: [],
  };
}

describe("flowActualHours", () => {
  it("verified 流返回真实小时数", () => {
    expect(flowActualHours(flow("a", "verified", 8))).toBe(8);
  });
  it("非 verified 流返回 null", () => {
    expect(flowActualHours(flow("a", "rolled-back", 8))).toBeNull();
  });
  it("updatedAt 不晚于 startedAt 返回 null", () => {
    expect(flowActualHours(flow("a", "verified", 0))).toBeNull();
  });
});

describe("velocitiesFromFlows", () => {
  it("≥3 个 verified 流 → 经验速率谱(actual/baseline)", () => {
    const vels = velocitiesFromFlows(
      [flow("a", "verified", 8), flow("b", "verified", 12), flow("c", "verified", 6)],
      8,
    );
    expect(vels.length).toBe(3);
    expect(vels).toEqual([1, 1.5, 0.75]);
  });
  it("滤掉非 verified、瞬时(<minH)、失控(>maxH)流", () => {
    const vels = velocitiesFromFlows(
      [
        flow("a", "verified", 8),
        flow("b", "verified", 12),
        flow("c", "verified", 6),
        flow("x", "rolled-back", 9),
        flow("y", "verified", 0.001), // 瞬时,滤掉
        flow("z", "verified", 999),   // 失控,滤掉
      ],
      8,
    );
    expect(vels).toEqual([1, 1.5, 0.75]);
  });
  it("理智带：退化分布(AI 分钟级流 vs 8h 基准,比值≈0.006)被带过滤滤空 → 回退默认谱", () => {
    // 0.05h ≈ 3 分钟,比值 0.05/8 ≈ 0.006,远低于 minVel 0.25 → 全部滤掉
    const tiny = [flow("a", "verified", 0.05), flow("b", "verified", 0.04), flow("c", "verified", 0.06), flow("d", "verified", 0.05)];
    expect(velocitiesFromFlows(tiny, 8)).toEqual([]);
  });
  it("理智带：带内样本保留、带外(过快/过慢)剔除", () => {
    // baseline 8:1h→0.125(带外,剔)、4h→0.5(带内)、8h→1(带内)、16h→2(带内)、40h→5(带外,剔)
    const mixed = [flow("a", "verified", 1), flow("b", "verified", 4), flow("c", "verified", 8), flow("d", "verified", 16), flow("e", "verified", 40)];
    expect(velocitiesFromFlows(mixed, 8)).toEqual([0.5, 1, 2]);
  });
  it("有效样本不足 minSamples → 回退空谱", () => {
    expect(velocitiesFromFlows([flow("a", "verified", 8), flow("b", "verified", 12)], 8)).toEqual([]);
  });
  it("baselineHours 非正 → 空谱", () => {
    expect(velocitiesFromFlows([flow("a", "verified", 8), flow("b", "verified", 12), flow("c", "verified", 6)], 0)).toEqual([]);
  });
});