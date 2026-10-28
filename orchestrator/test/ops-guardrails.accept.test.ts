import { describe, expect, it } from "vitest";
import { consecutiveNoProgress, isSensitiveWave, guardWave } from "../src/loop/ops-guard.js";

function act(delta: number, verified: boolean, at: number) {
  return { at, loopId: "l1", projectId: "p", recipe: "geo", lever: "x", subject: "s", metricKey: "k", metricAfter: 1, metricDelta: delta, verified };
}

describe("自运营护栏(作者验收)", () => {
  it("连败计数只数尾部连续无进展", () => {
    const actions = [act(1, true, 1), act(0, true, 2), act(-1, true, 3), act(0, false, 4)] as never;
    expect(consecutiveNoProgress(actions, "l1")).toBe(3);
    expect(consecutiveNoProgress([act(2, true, 9)] as never, "l1")).toBe(0);
    expect(consecutiveNoProgress([], "l1")).toBe(0);
  });

  it("敏感波识别覆盖部署/删除/付费/凭证", () => {
    expect(isSensitiveWave("部署到 production")).toBe(true);
    expect(isSensitiveWave("执行 rm -rf 清理")).toBe(true);
    expect(isSensitiveWave("升级付费套餐")).toBe(true);
    expect(isSensitiveWave("轮换 credential")).toBe(true);
    expect(isSensitiveWave("补充品类内容页")).toBe(false);
  });

  it("guardWave 判序:halt 优先于 sensitive,预算超限拦截,全过放行", () => {
    const bad3 = [act(0, false, 1), act(0, false, 2), act(0, false, 3)] as never;
    const v1 = guardWave({ actions: bad3, loopId: "l1", waveText: "部署 x", haltThreshold: 3 });
    expect(v1.allow).toBe(false);
    expect(v1.kind).toBe("halt");
    const v2 = guardWave({ actions: [], loopId: "l1", waveText: "发布新页面" });
    expect(v2.allow).toBe(false);
    expect(v2.kind).toBe("sensitive");
    const v3 = guardWave({ actions: [], loopId: "l1", waveText: "普通内容波", tokenBudget: 100, tokensSpent30d: 150 });
    expect(v3.allow).toBe(false);
    expect(v3.kind).toBe("budget");
    const v4 = guardWave({ actions: [], loopId: "l1", waveText: "普通内容波" });
    expect(v4.allow).toBe(true);
  });
});