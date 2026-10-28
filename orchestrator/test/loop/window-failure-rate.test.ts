import { describe, expect, it } from "vitest";
import { guardWave, windowFailureRate } from "../../src/loop/ops-guard.js";

function act(delta: number, verified: boolean, at: number, loopId = "l1") {
  return {
    at,
    loopId,
    projectId: "p",
    recipe: "geo",
    lever: "x",
    subject: "s",
    metricKey: "k",
    metricAfter: 1,
    metricDelta: delta,
    verified,
  };
}

function many(n: number, delta: number, verified: boolean, from = 1) {
  return Array.from({ length: n }, (_, i) => act(delta, verified, from + i));
}

describe("windowFailureRate", () => {
  it("空输入返回全零且不产生 NaN", () => {
    const s = windowFailureRate([] as never, "l1");
    expect(s).toEqual({ considered: 0, failed: 0, rate: 0 });
    expect(Number.isNaN(s.rate)).toBe(false);
  });

  it("只统计指定 loopId", () => {
    const actions = [...many(2, 0, false), act(0, false, 99, "other")] as never;
    expect(windowFailureRate(actions, "l1").considered).toBe(2);
  });

  it("窗口只取最后 W 条", () => {
    const actions = [...many(10, 1, true, 1), ...many(5, 0, false, 100)] as never;
    const s = windowFailureRate(actions, "l1", { window: 5 });
    expect(s.considered).toBe(5);
    expect(s.failed).toBe(5);
    expect(s.rate).toBe(1);
  });

  it("非 observational：metricDelta<=0 或 未 verified 都算失败", () => {
    const actions = [act(1, true, 1), act(0, true, 2), act(-1, true, 3), act(5, false, 4)] as never;
    const s = windowFailureRate(actions, "l1");
    expect(s.considered).toBe(4);
    expect(s.failed).toBe(3);
  });

  it("observational：只有 verified===false 算失败", () => {
    const actions = [act(-9, true, 1), act(-9, true, 2), act(0, false, 3)] as never;
    const s = windowFailureRate(actions, "l1", { observational: true });
    expect(s.considered).toBe(3);
    expect(s.failed).toBe(1);
  });

  it("guardReset 之后重新计数（人工恢复通道）", () => {
    const actions = [
      ...many(5, 0, false, 1),
      { ...act(0, true, 50), guardReset: true },
      act(1, true, 51),
    ] as never;
    const s = windowFailureRate(actions, "l1");
    expect(s.considered).toBe(1);
    expect(s.failed).toBe(0);
  });

  it("只有 guardReset 而其后无动作时 considered 为 0", () => {
    const actions = [...many(5, 0, false, 1), { ...act(0, true, 50), guardReset: true }] as never;
    expect(windowFailureRate(actions, "l1").considered).toBe(0);
  });

  it("不修改入参数组", () => {
    const actions = [act(0, false, 3), act(1, true, 1)] as never as { at: number }[];
    const before = actions.map((a) => a.at);
    windowFailureRate(actions as never, "l1");
    expect(actions.map((a) => a.at)).toEqual(before);
  });
});

describe("guardWave 用窗口失败率熔断", () => {
  it("关键回归：27 次成功 + 尾部 3 次失败，不得熔断", () => {
    const actions = [...many(27, 1, true, 1), ...many(3, 0, false, 100)] as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波" });
    expect(v.allow).toBe(true);
  });

  it("30 次里 24 次失败（正好 80%）必须熔断", () => {
    const actions = [...many(6, 1, true, 1), ...many(24, 0, false, 100)] as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波" });
    expect(v.allow).toBe(false);
    expect(v.kind).toBe("halt");
  });

  it("样本不足 minWindowSamples 时不熔断", () => {
    const actions = many(2, 0, false) as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波", minWindowSamples: 3 });
    expect(v.allow).toBe(true);
  });

  it("三条全失败仍然熔断（与既有测试一致）", () => {
    const actions = many(3, 0, false) as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波" });
    expect(v.allow).toBe(false);
    expect(v.kind).toBe("halt");
  });

  it("熔断理由带窗口统计：失败次数、考察次数、百分号", () => {
    const actions = many(5, 0, false) as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波" });
    expect(v.reason).toContain("5");
    expect(v.reason).toContain("%");
  });

  it("人工恢复后立刻放行（guardReset 归零）", () => {
    const actions = [
      ...many(10, 0, false, 1),
      { ...act(0, true, 50), guardReset: true },
    ] as never;
    const v = guardWave({ actions, loopId: "l1", waveText: "普通内容波" });
    expect(v.allow).toBe(true);
  });

  it("阈值可调：R=1.0 时 80% 失败不熔断", () => {
    const actions = [...many(6, 1, true, 1), ...many(24, 0, false, 100)] as never;
    const v = guardWave({
      actions,
      loopId: "l1",
      waveText: "普通内容波",
      failureRateThreshold: 1,
    });
    expect(v.allow).toBe(true);
  });
});