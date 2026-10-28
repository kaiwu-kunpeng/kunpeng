import { describe, it, expect } from "vitest";

import { consecutiveNoProgress, guardWave } from "../../src/loop/ops-guard.js";
import type { OpsAction } from "../../src/loop/action-ledger.js";

function failed(at: number): OpsAction {
  return {
    at,
    loopId: "L1",
    projectId: "P1",
    recipe: "wechat-capture",
    lever: "sweep",
    subject: "限频",
    metricKey: "captured",
    metricAfter: 180,
    metricDelta: 0,
    verified: false,
  };
}

function reset(at: number): OpsAction {
  return {
    at,
    loopId: "L1",
    projectId: "P1",
    recipe: "wechat-capture",
    lever: "guard-reset",
    subject: "限频已过，人工恢复",
    metricKey: "captured",
    metricAfter: 180,
    metricDelta: 0,
    verified: true,
    guardReset: true,
    note: "限频已过，人工恢复",
  };
}

describe("loop 熔断的人工恢复通道", () => {
  it("没有 guardReset 时，三连败仍然计满 3 并熔断", () => {
    const actions = [failed(1), failed(2), failed(3)];
    expect(consecutiveNoProgress(actions, "L1")).toBe(3);
    expect(guardWave({ actions, loopId: "L1", waveText: "采集一波" }).allow).toBe(false);
  });

  it("追加 guardReset 后连败计数归零且放行", () => {
    const actions = [failed(1), failed(2), failed(3), reset(4)];
    expect(consecutiveNoProgress(actions, "L1")).toBe(0);
    expect(guardWave({ actions, loopId: "L1", waveText: "采集一波" }).allow).toBe(true);
  });

  it("observational 模式下 guardReset 同样阻断倒数", () => {
    const actions = [failed(1), failed(2), failed(3), reset(4)];
    expect(consecutiveNoProgress(actions, "L1", { observational: true })).toBe(0);
  });

  it("guardReset 之后再失败两次，只数 guardReset 之后的那两次", () => {
    const actions = [failed(1), failed(2), failed(3), reset(4), failed(5), failed(6)];
    expect(consecutiveNoProgress(actions, "L1")).toBe(2);
    expect(guardWave({ actions, loopId: "L1", waveText: "采集一波" }).allow).toBe(true);
  });

  it("guardReset 只对同一个 loop 生效", () => {
    const other: OpsAction = { ...reset(4), loopId: "L2" };
    const actions = [failed(1), failed(2), failed(3), other];
    expect(consecutiveNoProgress(actions, "L1")).toBe(3);
  });
});