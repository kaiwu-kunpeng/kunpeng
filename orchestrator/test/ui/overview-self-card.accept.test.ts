import { describe, expect, it } from "vitest";
import { selfCardStats } from "../../src/server/ui/views/overview.js";

describe("总览鲲鹏本体卡取数(作者验收)", () => {
  it("有 self → 用鲲鹏累计数", () => {
    const st = selfCardStats({
      self: { srcLines: 76157, testLines: 50303, completed: 470, flowsTotal: 1847, plansTotal: 681 },
      code: { srcLines: 1, testLines: 1, completed: 1 },
      plans: [{}, {}],
      flows: [{}],
    } as unknown as Parameters<typeof selfCardStats>[0]);
    expect(st.srcLines).toBe(76157);
    expect(st.plans).toBe(681);
    expect(st.flows).toBe(1847);
    expect(st.completed).toBe(470);
  });

  it("无 self → 回退到当前 code/plans.length/flows.length", () => {
    const st = selfCardStats({
      code: { srcLines: 100, testLines: 20, completed: 5 },
      plans: [{}, {}, {}],
      flows: [{}, {}],
    } as unknown as Parameters<typeof selfCardStats>[0]);
    expect(st.srcLines).toBe(100);
    expect(st.plans).toBe(3);
    expect(st.flows).toBe(2);
    expect(st.completed).toBe(5);
  });
});
import { selfCardStats as _selfCardStats } from "../../src/server/ui/views/overview.js";
describe("selfCardStats passedLines 取 self(kunpeng) 非 snaps[0]", () => {
  it("有 self 时 passedLines 用 self.passedLines", () => {
    const state = {
      self: { srcLines: 77003, testLines: 50670, passedLines: 127673, completed: 470, flowsTotal: 1869, plansTotal: 681 },
      code: { srcLines: 77003, testLines: 50670, passedLines: 60704, completed: 5, inFlightLines: 0, running: 0, rolledBack: 0 },
      plans: [], flows: [],
    } as unknown as Parameters<typeof _selfCardStats>[0];
    const st = _selfCardStats(state);
    expect(st.passedLines).toBe(127673);
    expect(st.completed).toBe(470);
  });
});
