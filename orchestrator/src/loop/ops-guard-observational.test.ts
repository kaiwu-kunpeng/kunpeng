import { describe, it, expect } from "vitest";
import { consecutiveNoProgress, guardWave } from "./ops-guard.js";
import type { OpsAction } from "./action-ledger.js";

function action(at: number, verified: boolean, metricDelta: number): OpsAction {
  return { at, loopId: "L", projectId: "p", recipe: "agent-playbook", lever: "lv", subject: "s", metricKey: "k", metricAfter: 0, metricDelta, verified };
}

describe("consecutiveNoProgress", () => {
  it("默认行为不变:verified 但零增量仍算无进展", () => {
    const actions = [action(1, true, 0), action(2, true, 0), action(3, true, 0)];
    expect(consecutiveNoProgress(actions, "L")).toBe(3);
  });

  it("默认行为不变:有正增量且 verified 时断开计数", () => {
    const actions = [action(1, true, 0), action(2, true, 5), action(3, true, 0)];
    expect(consecutiveNoProgress(actions, "L")).toBe(1);
  });

  it("observational:verified 的波即算有进展,零增量不再累计", () => {
    const actions = [action(1, true, 0), action(2, true, 0), action(3, true, 0)];
    expect(consecutiveNoProgress(actions, "L", { observational: true })).toBe(0);
  });

  it("observational:只有测量失败(未 verified)才累计", () => {
    const actions = [action(1, true, 0), action(2, false, 0), action(3, false, 0)];
    expect(consecutiveNoProgress(actions, "L", { observational: true })).toBe(2);
  });

  it("observational 的 loop 连续三波零增量但都 verified 时不熔断", () => {
    const actions = [action(1, true, 0), action(2, true, 0), action(3, true, 0)];
    const denied = guardWave({ actions, loopId: "L", waveText: "sweep" });
    expect(denied.allow).toBe(false);
    const allowed = guardWave({ actions, loopId: "L", waveText: "sweep", observational: true });
    expect(allowed.allow).toBe(true);
  });
});